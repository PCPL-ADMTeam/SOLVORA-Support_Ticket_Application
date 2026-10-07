// Maps OPENROUTER_REASONING_EFFORT to OpenRouter's `reasoning` request field.
//   ""    -> nothing is sent (the model's default applies)
//   "off" -> { enabled: false }   (only honored by models whose reasoning is optional)
//   other -> { effort }
// It is applied to every model in the chain; with provider.require_parameters a
// model that does not support `reasoning` is refused rather than silently ignoring it.
function reasoningField(effort) {
  if (!effort) return undefined;
  if (effort === "off") return { enabled: false };
  return { effort };
}

module.exports = { reasoningField };
