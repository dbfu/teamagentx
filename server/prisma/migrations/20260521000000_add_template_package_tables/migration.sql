CREATE TABLE "TemplatePackage" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TemplateImportRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "importedBy" TEXT,
    "importAction" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "TemplatePackage_templateId_version_idx" ON "TemplatePackage"("templateId", "version");
CREATE INDEX "TemplateImportRecord_templateId_version_idx" ON "TemplateImportRecord"("templateId", "version");
CREATE INDEX "TemplateImportRecord_chatRoomId_idx" ON "TemplateImportRecord"("chatRoomId");
