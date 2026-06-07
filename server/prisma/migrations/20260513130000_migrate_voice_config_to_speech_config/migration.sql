-- Migrate legacy voiceConfig to speechConfig.

ALTER TABLE "Agent" ADD COLUMN "speechConfig" TEXT;

UPDATE "Agent"
SET "speechConfig" = CASE
  WHEN "voiceConfig" IS NULL THEN NULL
  ELSE json_object(
    'behavior', json_object(
      'enabled', CASE WHEN json_extract("voiceConfig", '$.enabled') = 1 THEN json('true') ELSE json('false') END,
      'outputMode', COALESCE(json_extract("voiceConfig", '$.outputMode'), 'off'),
      'autoPlay', CASE WHEN json_extract("voiceConfig", '$.autoPlay') = 1 THEN json('true') ELSE json('false') END
    ),
    'profile', json_object(
      'provider', COALESCE(json_extract("voiceConfig", '$.provider'), 'browser-local'),
      'model', NULL,
      'voice', json_extract("voiceConfig", '$.voiceId'),
      'fallbackProvider', NULL,
      'speed', COALESCE(json_extract("voiceConfig", '$.speed'), 1),
      'volume', COALESCE(json_extract("voiceConfig", '$.volume'), 1),
      'pitch', NULL,
      'emotion', NULL,
      'style', NULL,
      'format', NULL,
      'sampleRate', NULL,
      'temperature', NULL,
      'prompt', NULL,
      'vendorOptions', NULL
    )
  )
END;
