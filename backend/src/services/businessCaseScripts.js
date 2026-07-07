// Ruby script templates for the Business Case Creator feature.
// Source of truth lives here in-repo so the feature can't be broken by
// anyone editing or deleting rows in the runcake scripts table.

// Combined one-shot script: creates metrics and configures the problem in a
// single ActiveRecord transaction, so metric IDs flow in-process (no stdout
// round-trip between steps) and the whole operation is atomic — if anything
// fails, nothing commits.
const COMBINED_SCRIPT_RUBY = `require 'json'

problem_id = {{problem_id}}
use_ai = {{use_ai_bool}}

metrics_input = <<~METRICS
{{metrics}}
METRICS

result_summary = {
  problem_id: problem_id,
  use_ai: use_ai,
  metric_ids: [],
  status: 'failed',
  message: nil
}

begin
  ActiveRecord::Base.transaction do
    puts "============== Metrics =============="
    puts metrics_input
    puts "============== Metrics =============="

    last_id_before = EvaluationMetric.maximum(:id) || 0

    evaluation_metrics = []
    metrics_input.split("\\n").each do |metric|
      next if metric.strip.empty?
      key, value = metric.split(":", 2)
      key = key.to_s.strip
      value = value.to_s.strip
      evaluation_metrics << EvaluationMetric.new(
        name: key,
        description: value,
        min_score: 0,
        max_score: 10,
        status: :active
      )
    end

    import_result = EvaluationMetric.import(
      evaluation_metrics,
      on_duplicate_key_ignore: true,
      validate: true
    )
    puts "Import num_inserts: #{import_result.num_inserts}"
    puts "Import errors: #{import_result.failed_instances.map(&:errors).map(&:full_messages)}"

    # activerecord-import's result.ids is empty under INSERT IGNORE on MySQL,
    # so query back by id range + submitted names (deterministic + safe vs
    # concurrent inserts from other sessions).
    submitted_names = evaluation_metrics.map(&:name)
    new_ids = EvaluationMetric.where('id > ?', last_id_before)
                              .where(name: submitted_names)
                              .order(:id)
                              .pluck(:id)
    puts "New metric ids: #{new_ids}"

    raise "No new metric rows created (expected #{submitted_names.length})" if new_ids.empty?

    problem = Problem.find(problem_id)
    puts "Found problem #{problem.id}: #{problem.problem_statement}"

    new_ids.each do |metric_id|
      EvaluationMetricAssociation.create_evaluation_metric_association(
        "Problem",
        problem.id,
        metric_id
      )
    end
    puts "Created #{new_ids.length} EvaluationMetricAssociation rows"

    problem.setup_default_crowd_judge_design_config
    puts "Ran setup_default_crowd_judge_design_config"

    if use_ai
      config = Config.find_by_slug("Problem#smart_business_case_study_judge#enabled")
      raise "Missing AI config slug 'Problem#smart_business_case_study_judge#enabled'" if config.nil?
      ConfigValue.create!(
        config_id: config.id,
        config_responder: problem,
        status: :active,
        value: "true"
      )
      puts "Created AI ConfigValue"
    end

    problem.novel_closed!
    problem.problem_metum.update!(use_editor: "rich_text")
    puts "Problem transitioned to novel_closed with rich_text editor"

    result_summary[:metric_ids] = new_ids
    result_summary[:status] = 'success'
  end

  puts "============== Done =============="
  puts "Problem #{problem_id} configured (use_ai=#{use_ai})"
  puts "============== Done =============="
rescue => e
  result_summary[:status] = 'failed'
  result_summary[:message] = e.message
  puts "============== Error =============="
  puts "Error: #{e.message}"
  puts e.backtrace.take(10).join("\\n") if e.backtrace
  puts "============== Error =============="
end

puts "BCC_RESULT_JSON=#{result_summary.to_json}"
`

// Format the user's metrics array into the single-string shape the Ruby expects:
//   Name: Description\nName: Description
// No trailing newline. Caller must have validated that no title/description
// contains ':' or '"'.
const formatMetricsString = (metrics) =>
  metrics.map((m) => `${m.title.trim()}: ${m.description.trim()}`).join('\n')

const renderTemplate = (template, values) => {
  let out = template
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(String(value))
  }
  return out
}

// Render the combined script with user input.
const renderCombinedScript = ({ problemId, metrics, useAi }) =>
  renderTemplate(COMBINED_SCRIPT_RUBY, {
    problem_id: String(problemId),
    use_ai_bool: useAi ? 'true' : 'false',
    metrics: formatMetricsString(metrics),
  })

// Parse the `BCC_RESULT_JSON={...}` line the Ruby emits on its last line.
// Using a structured marker + JSON is robust: either we get a valid object
// with known keys, or we return null and the caller surfaces a clear error.
const parseCombinedResult = (output) => {
  if (typeof output !== 'string') return null
  const match = output.match(/BCC_RESULT_JSON=(\{[\s\S]*?\})\s*$/m)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

// --- Existing-metrics variant -----------------------------------------------
//
// Skips creation. Looks up existing EvaluationMetric rows by id, then runs
// the same association + problem state transitions as COMBINED_SCRIPT_RUBY.
const ASSOCIATE_EXISTING_SCRIPT_RUBY = `require 'json'

problem_id = {{problem_id}}
use_ai = {{use_ai_bool}}
metric_ids = {{metric_ids_json}}

result_summary = {
  problem_id: problem_id,
  use_ai: use_ai,
  metric_ids: [],
  status: 'failed',
  message: nil
}

begin
  ActiveRecord::Base.transaction do
    puts "============== Existing metric ids =============="
    puts metric_ids.inspect
    puts "============== Existing metric ids =============="

    found = EvaluationMetric.where(id: metric_ids).pluck(:id)
    missing = metric_ids - found
    raise "Metric ids not found: #{missing.inspect}" unless missing.empty?

    problem = Problem.find(problem_id)
    puts "Found problem #{problem.id}: #{problem.problem_statement}"

    metric_ids.each do |metric_id|
      EvaluationMetricAssociation.create_evaluation_metric_association(
        "Problem",
        problem.id,
        metric_id
      )
    end
    puts "Created #{metric_ids.length} EvaluationMetricAssociation rows"

    problem.setup_default_crowd_judge_design_config
    puts "Ran setup_default_crowd_judge_design_config"

    if use_ai
      config = Config.find_by_slug("Problem#smart_business_case_study_judge#enabled")
      raise "Missing AI config slug 'Problem#smart_business_case_study_judge#enabled'" if config.nil?
      ConfigValue.create!(
        config_id: config.id,
        config_responder: problem,
        status: :active,
        value: "true"
      )
      puts "Created AI ConfigValue"
    end

    problem.novel_closed!
    problem.problem_metum.update!(use_editor: "rich_text")
    puts "Problem transitioned to novel_closed with rich_text editor"

    result_summary[:metric_ids] = metric_ids
    result_summary[:status] = 'success'
  end

  puts "============== Done =============="
  puts "Problem #{problem_id} configured (use_ai=#{use_ai}) with existing metrics"
  puts "============== Done =============="
rescue => e
  result_summary[:status] = 'failed'
  result_summary[:message] = e.message
  puts "============== Error =============="
  puts "Error: #{e.message}"
  puts e.backtrace.take(10).join("\\n") if e.backtrace
  puts "============== Error =============="
end

puts "BCC_RESULT_JSON=#{result_summary.to_json}"
`

const renderAssociateExistingScript = ({ problemId, metricIds, useAi }) =>
  renderTemplate(ASSOCIATE_EXISTING_SCRIPT_RUBY, {
    problem_id: String(problemId),
    use_ai_bool: useAi ? 'true' : 'false',
    metric_ids_json: JSON.stringify(metricIds),
  })

// --- Preview script ---------------------------------------------------------
//
// Read-only: fetches title/description/score range for each requested id.
// Output marker is BCC_PREVIEW_JSON so the existing /executions endpoint can
// disambiguate from orchestrate results.
const PREVIEW_METRICS_SCRIPT_RUBY = `require 'json'

metric_ids = {{metric_ids_json}}

result = {
  status: 'success',
  metrics: [],
  missing: []
}

begin
  rows = EvaluationMetric.where(id: metric_ids).pluck(:id, :name, :description, :min_score, :max_score)
  found_ids = rows.map(&:first)
  result[:missing] = metric_ids - found_ids
  result[:metrics] = rows.map do |id, name, description, min_score, max_score|
    {
      id: id,
      name: name,
      description: description,
      min_score: min_score,
      max_score: max_score
    }
  end
rescue => e
  result[:status] = 'failed'
  result[:message] = e.message
end

puts "BCC_PREVIEW_JSON=#{result.to_json}"
`

const renderPreviewMetricsScript = ({ metricIds }) =>
  renderTemplate(PREVIEW_METRICS_SCRIPT_RUBY, {
    metric_ids_json: JSON.stringify(metricIds),
  })

const parsePreviewResult = (output) => {
  if (typeof output !== 'string') return null
  const match = output.match(/BCC_PREVIEW_JSON=(\{[\s\S]*?\})\s*$/m)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

// --- Update: remove selected metrics, then add new ones (atomic) ------------
//
// A single ActiveRecord transaction that:
//   1. Removes the selected metric associations (scoped by remove_metric_ids;
//      empty removes none) and their EvaluationResponse rows.
//   2. Adds new metrics — either creating new EvaluationMetric rows from the
//      `metrics` heredoc (add_mode='create') or reusing existing metric ids
//      (add_mode='existing') — and associates them to the problem.
// All-or-nothing: if the add step fails, the removals roll back too. Emits
// BCC_RESULT_JSON so the existing /executions endpoint + parseCombinedResult
// handle it unchanged.
const UPDATE_BUSINESS_CASE_SCRIPT_RUBY = `require 'json'

problem_id = {{problem_id}}
remove_metric_ids = {{remove_metric_ids_json}}
add_metric_ids = {{add_metric_ids_json}}

metrics_input = <<~METRICS
{{metrics}}
METRICS

result_summary = {
  problem_id: problem_id,
  status: 'failed',
  removed_associations: 0,
  removed_responses: 0,
  added_metric_ids: [],
  message: nil
}

begin
  problem = Problem.find(problem_id)
  puts "Found problem #{problem.id}: #{problem.problem_statement}"

  ActiveRecord::Base.transaction do
    # ----- 1. Remove the selected metric associations + their responses -----
    scope = EvaluationMetricAssociation.where(owner: problem)
    scope = scope.where(evaluation_metric_id: remove_metric_ids) if remove_metric_ids.present?
    assoc_ids = scope.pluck(:id)
    if assoc_ids.any?
      removed_responses = EvaluationResponse.where(evaluation_metric_association_id: assoc_ids).count
      EvaluationResponse.where(evaluation_metric_association_id: assoc_ids).delete_all
      EvaluationMetricAssociation.where(id: assoc_ids).destroy_all
      result_summary[:removed_associations] = assoc_ids.length
      result_summary[:removed_responses] = removed_responses
    end
    puts "Removed #{result_summary[:removed_associations]} association(s) and #{result_summary[:removed_responses]} response(s)"

    # ----- 2. Create any brand-new metrics from the metrics heredoc -----
    created_ids = []
    new_metrics = []
    metrics_input.split("\\n").each do |metric|
      next if metric.strip.empty?
      key, value = metric.split(":", 2)
      new_metrics << EvaluationMetric.new(
        name: key.to_s.strip,
        description: value.to_s.strip,
        min_score: 0,
        max_score: 10,
        status: :active
      )
    end

    if new_metrics.any?
      last_id_before = EvaluationMetric.maximum(:id) || 0
      import_result = EvaluationMetric.import(
        new_metrics,
        on_duplicate_key_ignore: true,
        validate: true
      )
      puts "Import num_inserts: #{import_result.num_inserts}"
      submitted_names = new_metrics.map(&:name)
      created_ids = EvaluationMetric.where('id > ?', last_id_before)
                                    .where(name: submitted_names)
                                    .order(:id)
                                    .pluck(:id)
      raise "No new metric rows created (expected #{submitted_names.length})" if created_ids.empty?
    end

    # ----- 3. Validate the existing metric ids to (re)associate -----
    if add_metric_ids.present?
      found = EvaluationMetric.where(id: add_metric_ids).pluck(:id)
      missing = add_metric_ids - found
      raise "Metric ids not found: #{missing.inspect}" unless missing.empty?
    end

    # ----- 4. Associate created + existing metrics with the problem -----
    # Dedupe defensively: never re-add a metric we just removed (avoid
    # remove+add churn) and never duplicate a metric still associated.
    remaining_ids = EvaluationMetricAssociation.where(owner: problem).pluck(:evaluation_metric_id)
    all_ids = (created_ids + add_metric_ids).uniq - remove_metric_ids - remaining_ids
    all_ids.each do |metric_id|
      EvaluationMetricAssociation.create_evaluation_metric_association(
        "Problem",
        problem.id,
        metric_id
      )
    end
    puts "Associated #{all_ids.length} metric(s): #{all_ids.inspect}"

    result_summary[:added_metric_ids] = all_ids
    result_summary[:status] = 'success'
  end

  puts "============== Done =============="
  puts "Update complete for problem #{problem_id}"
  puts "============== Done =============="
rescue => e
  result_summary[:status] = 'failed'
  result_summary[:message] = e.message
  puts "============== Error =============="
  puts "Error: #{e.message}"
  puts e.backtrace.take(10).join("\\n") if e.backtrace
  puts "============== Error =============="
end

puts "BCC_RESULT_JSON=#{result_summary.to_json}"
`

// removeMetricIds: metrics the user selected to remove (empty removes none).
// metrics: brand-new metrics to create (may be empty). addMetricIds: existing
// metric ids to associate (may be empty). Created + existing are unioned and
// associated. All three can be combined in one update.
const renderUpdateBusinessCaseScript = ({ problemId, removeMetricIds, metrics, addMetricIds }) =>
  renderTemplate(UPDATE_BUSINESS_CASE_SCRIPT_RUBY, {
    problem_id: String(problemId),
    remove_metric_ids_json: JSON.stringify(Array.isArray(removeMetricIds) ? removeMetricIds : []),
    add_metric_ids_json: JSON.stringify(Array.isArray(addMetricIds) ? addMetricIds : []),
    metrics: formatMetricsString(metrics || []),
  })

// --- Reevaluate responses ---------------------------------------------------
//
// Re-runs the SmartJudge business-case evaluation for candidate responses of a
// problem. For each email it finds the IBTSP, keeps one AI evaluator
// association, archives the rest, resets status, then ENQUEUES the evaluation
// via EvaluateService.execute_later (runs in the background). It still logs each
// email's old/new score and a success/error status to stdout. The backend fires
// this without polling. Per-email failures are captured and do not abort the run.
const REEVALUATE_RESPONSES_SCRIPT_RUBY = `require 'json'

problem_id = {{problem_id}}
chunk_size = {{chunk_size}}

emails = %w[
{{emails}}
]

result_summary = {
  problem_id: problem_id,
  status: 'failed',
  total: emails.size,
  success_count: 0,
  error_count: 0,
  message: nil
}

begin
  problem = Problem.find(problem_id)

  ai_ids = EvaluationEvaluatorAssociation.ai_evaluator_ids
  assistant_user_id = ai_ids.first
  raise "No AI evaluator user found" unless assistant_user_id.present?

  results = []
  total_chunks = (emails.size.to_f / chunk_size).ceil

  emails.each_slice(chunk_size).with_index do |batch_emails, chunk_index|
    puts "Running batch #{chunk_index + 1}/#{total_chunks}: #{batch_emails.inspect}"

    batch_emails.each do |email|
      begin
        user = User.find_by(email: email)

        ibtsp = InterviewbitTestSessionProblem
          .joins(:interviewbit_test_session)
          .where(problem_id: problem.id)
          .where(
            "interviewbit_test_sessions.user_id = ? OR interviewbit_test_sessions.candidate_email = ?",
            user&.id,
            email
          )
          .order(created_at: :desc)
          .first

        raise "No matching IBTSP" unless ibtsp.present?

        mode = EvaluationEntity.configured_evaluation_mode(ibtsp)
        raise "Wrong mode=#{mode}; expected business_case_study_judge" unless mode == :business_case_study_judge

        ee = ibtsp.evaluation_entity || EvaluationEntity.create_evaluation_entity(ibtsp.class.name, ibtsp.id)
        old_score = ibtsp.score

        keep = ee.evaluation_evaluator_associations.non_peer
          .where(evaluator_id: ai_ids)
          .order(created_at: :desc)
          .first

        keep ||= EvaluationEvaluatorAssociation.create_association(ee.id, assistant_user_id, :non_peer)
        keep ||= ee.evaluation_evaluator_associations.non_peer.where(evaluator_id: assistant_user_id).order(created_at: :desc).first

        raise "Could not create/find AI EEA" unless keep.present?

        ee.evaluation_evaluator_associations.non_peer.where.not(id: keep.id).update_all(
          evaluation_status: EvaluationEvaluatorAssociation.evaluation_statuses[:archived],
          updated_at: Time.current
        )

        ee.update_columns(
          completed_non_peer_count: keep.completed? ? 1 : 0,
          updated_at: Time.current
        )

        keep.update!(evaluation_status: :started) if keep.completed? || keep.archived?

        # Enqueue the evaluation to run in the background (execute_later) instead
        # of running it inline. The job recomputes scores when it runs; we still
        # log the current old/new score and mark dispatch success.
        EvaluationEntities::SmartJudge::EvaluateService.execute_later(
          evaluation_entity_id: ee.id,
          evaluation_id: keep.id,
          retry_count: 0
        )

        ibtsp.reload
        new_score = ibtsp.cumulative_crowd_evaluation_score(options: { created_at: ee.created_at }, with_decay: true)
        ibtsp.update_columns(score: new_score, updated_at: Time.current) if new_score.present?

        session = ibtsp.interviewbit_test_session
        session.update_score
        session.update_session_rating_in_cache_store

        results << {
          email: email,
          ibtsp_id: ibtsp.id,
          ee_id: ee.id,
          eea_id: keep.reload.id,
          old_score: old_score,
          new_score: ibtsp.reload.score,
          session_id: session.id,
          session_score: session.reload.score,
          status: "success"
        }

        puts "SUCCESS #{email}: #{old_score} -> #{ibtsp.score}"
      rescue => e
        results << { email: email, status: "error", error: "#{e.class}: #{e.message}" }
        puts "ERROR #{email}: #{e.class}: #{e.message}"
      end
    end
  end

  puts "\\nEMAIL\\tOLD_SCORE\\tNEW_SCORE\\tIBTSP\\tEE\\tEEA\\tSESSION_SCORE\\tSTATUS"
  results.each do |r|
    puts [
      r[:email],
      r[:old_score],
      r[:new_score],
      r[:ibtsp_id],
      r[:ee_id],
      r[:eea_id],
      r[:session_score],
      r[:status],
      r[:error]
    ].join("\\t")
  end

  result_summary[:success_count] = results.count { |r| r[:status] == "success" }
  result_summary[:error_count] = results.count { |r| r[:status] == "error" }
  result_summary[:status] = 'success'
rescue => e
  result_summary[:status] = 'failed'
  result_summary[:message] = "#{e.class}: #{e.message}"
  puts "============== Error =============="
  puts "Error: #{e.message}"
  puts e.backtrace.take(10).join("\\n") if e.backtrace
  puts "============== Error =============="
end

puts "BCC_RESULT_JSON=#{result_summary.to_json}"
`

// emails: array of validated email strings (no whitespace — they render inside
// a Ruby %w[] literal). chunkSize defaults to 5.
const renderReevaluateResponsesScript = ({ problemId, emails, chunkSize }) =>
  renderTemplate(REEVALUATE_RESPONSES_SCRIPT_RUBY, {
    problem_id: String(problemId),
    chunk_size: String(Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : 5),
    emails: (Array.isArray(emails) ? emails : []).join('\n  '),
  })

// Reject metric fields that would break the Ruby's `metric.split(":", 2)` or
// the <<~METRICS heredoc. Called from the route handler.
const validateMetric = (metric, index) => {
  const errors = []
  const prefix = `metrics[${index}]`
  if (!metric || typeof metric !== 'object') {
    return [`${prefix}: must be an object`]
  }
  const { title, description, min_marks, max_marks } = metric
  if (typeof title !== 'string' || title.trim() === '') {
    errors.push(`${prefix}.title: required`)
  } else if (title.includes(':')) {
    errors.push(`${prefix}.title: must not contain ":"`)
  } else if (title.includes('"')) {
    errors.push(`${prefix}.title: must not contain '"'`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push(`${prefix}.description: required`)
  } else if (description.includes(':')) {
    errors.push(`${prefix}.description: must not contain ":"`)
  } else if (description.includes('"')) {
    errors.push(`${prefix}.description: must not contain '"'`)
  }
  const minNum = Number(min_marks)
  const maxNum = Number(max_marks)
  if (!Number.isFinite(minNum) || minNum < 0) {
    errors.push(`${prefix}.min_marks: must be a non-negative number`)
  }
  if (!Number.isFinite(maxNum) || maxNum < 0) {
    errors.push(`${prefix}.max_marks: must be a non-negative number`)
  }
  if (Number.isFinite(minNum) && Number.isFinite(maxNum) && minNum > maxNum) {
    errors.push(`${prefix}: min_marks must be <= max_marks`)
  }
  return errors
}

module.exports = {
  COMBINED_SCRIPT_RUBY,
  ASSOCIATE_EXISTING_SCRIPT_RUBY,
  PREVIEW_METRICS_SCRIPT_RUBY,
  formatMetricsString,
  renderTemplate,
  renderCombinedScript,
  renderAssociateExistingScript,
  renderPreviewMetricsScript,
  renderUpdateBusinessCaseScript,
  UPDATE_BUSINESS_CASE_SCRIPT_RUBY,
  renderReevaluateResponsesScript,
  REEVALUATE_RESPONSES_SCRIPT_RUBY,
  parseCombinedResult,
  parsePreviewResult,
  validateMetric,
}
