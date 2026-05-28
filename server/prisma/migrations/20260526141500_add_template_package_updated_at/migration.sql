CREATE TABLE "new_TemplatePackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "manifestJson" TEXT NOT NULL,
    "compatibilityJson" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_TemplatePackage" (
    "id",
    "templateId",
    "version",
    "title",
    "summary",
    "sourceType",
    "sourceLabel",
    "manifestJson",
    "compatibilityJson",
    "createdBy",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "templateId",
    "version",
    "title",
    "summary",
    "sourceType",
    "sourceLabel",
    "manifestJson",
    "compatibilityJson",
    "createdBy",
    "createdAt",
    "createdAt"
FROM "TemplatePackage";

DROP TABLE "TemplatePackage";

ALTER TABLE "new_TemplatePackage" RENAME TO "TemplatePackage";

CREATE INDEX "TemplatePackage_templateId_version_idx" ON "TemplatePackage"("templateId", "version");
