-- Normalize legacy provider-specific type values to the current custom-only provider model.
-- API protocol, URL, key, model, and agent bindings are preserved.
UPDATE "LlmProvider"
SET "type" = 'custom'
WHERE "type" <> 'custom';
