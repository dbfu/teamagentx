-- 修复 TemplatePackage updatedAt 字段定义
-- 从 DEFAULT CURRENT_TIMESTAMP 改为无默认值（Prisma @updatedAt 由客户端运行时管理）
-- SQLite 不支持 ON UPDATE 触发器，Prisma 在更新操作时自动设置该字段

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TemplatePackage" ("id", "templateId", "version", "title", "summary", "sourceType", "sourceLabel", "manifestJson", "compatibilityJson", "createdBy", "createdAt", "updatedAt") SELECT "id", "templateId", "version", "title", "summary", "sourceType", "sourceLabel", "manifestJson", "compatibilityJson", "createdBy", "createdAt", "updatedAt" FROM "TemplatePackage";
DROP TABLE "TemplatePackage";
ALTER TABLE "new_TemplatePackage" RENAME TO "TemplatePackage";
CREATE INDEX "TemplatePackage_templateId_version_idx" ON "TemplatePackage"("templateId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;