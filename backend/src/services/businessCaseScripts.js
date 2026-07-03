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
  parseCombinedResult,
  parsePreviewResult,
  validateMetric,
}
