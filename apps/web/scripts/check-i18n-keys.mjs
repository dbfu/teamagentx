/**
 * i18n key 检查脚本
 *
 * 功能：
 * 1. 扫描所有 tsx/ts 文件，提取 t('key') 中的 key
 * 2. 检查每个 key 在 locale 文件中是否存在
 * 3. 检查是否存在"返回对象而非字符串"的问题（重复键导致）
 * 4. 扫描原始 JSON 文件，检测重复键定义
 *
 * 使用：pnpm run check-i18n
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webRoot = join(__dirname, '..')
const localesDir = join(webRoot, 'src/i18n/locales')

// 递归获取所有文件
function getAllFiles(dir, ext = '.tsx') {
  const files = []
  const items = readdirSync(dir)
  for (const item of items) {
    const fullPath = join(dir, item)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, ext))
    } else if (item.endsWith(ext)) {
      files.push(fullPath)
    }
  }
  return files
}

// 提取 t() 调用中的 key 和是否使用 returnObjects
function extractTKeys(content) {
  const keys = []
  // 匹配 t('key') 和 t('key', { params })
  // 使用 \b 确保 t 是独立的函数名，排除 searchParams.get('room') 等误匹配
  // 只匹配标准的 namespace.key 格式
  const regex = /\bt\(['"`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)['"`](?:\s*,\s*([^)]+))?\)/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const key = match[1]
    const params = match[2] || ''
    const usesReturnObjects = params.includes('returnObjects')
    keys.push({ key, usesReturnObjects })
  }
  return keys
}

// 检查 key 在 locale 对象中的值类型
function checkKeyType(localeObj, key) {
  const parts = key.split('.')
  let current = localeObj
  for (const part of parts) {
    if (current === undefined || current === null) {
      return { exists: false, type: 'missing' }
    }
    if (typeof current !== 'object') {
      return { exists: false, type: 'broken', message: `中间路径 "${part}" 不是对象` }
    }
    current = current[part]
  }
  if (current === undefined) {
    return { exists: false, type: 'missing' }
  }
  return { exists: true, type: typeof current }
}

// 扫描原始 JSON 文件中的重复键
function findDuplicateKeys(jsonPath) {
  const content = readFileSync(jsonPath, 'utf-8')
  const lines = content.split('\n')
  const keyStack = [] // [{ namespace, line, key }]
  const allKeys = [] // [{ path: 'chat.taskBoard', line, isObject }]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // 检测 namespace 开始: "xxx": {
    const namespaceStartMatch = line.match(/^(\s*)"([^"]+)":\s*\{$/)
    if (namespaceStartMatch) {
      const indent = namespaceStartMatch[1].length
      const key = namespaceStartMatch[2]
      // 计算当前路径
      while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
        keyStack.pop()
      }
      const parentPath = keyStack.map(k => k.key).join('.')
      const fullPath = parentPath ? `${parentPath}.${key}` : key
      keyStack.push({ indent, key, line: lineNum, fullPath })
      continue
    }

    // 检测字符串键: "xxx": "yyy"
    const stringKeyMatch = line.match(/^(\s*)"([^"]+)":\s*"([^"]*)"/)
    if (stringKeyMatch) {
      const indent = stringKeyMatch[1].length
      const key = stringKeyMatch[2]
      while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
        keyStack.pop()
      }
      const parentPath = keyStack.map(k => k.key).join('.')
      const fullPath = parentPath ? `${parentPath}.${key}` : key
      allKeys.push({ path: fullPath, line: lineNum, isObject: false })
      continue
    }

    // 检测对象键开始: "xxx": { (不带前导空格匹配的，处理嵌套在同一行的情况)
    const objectKeyMatch = line.match(/^(\s*)"([^"]+)":\s*\{$/)
    if (objectKeyMatch) {
      const indent = objectKeyMatch[1].length
      const key = objectKeyMatch[2]
      while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
        keyStack.pop()
      }
      const parentPath = keyStack.map(k => k.key).join('.')
      const fullPath = parentPath ? `${parentPath}.${key}` : key
      allKeys.push({ path: fullPath, line: lineNum, isObject: true })
      keyStack.push({ indent, key, line: lineNum, fullPath })
    }
  }

  // 找出重复路径
  const duplicates = []
  const keyMap = new Map()
  for (const k of allKeys) {
    if (keyMap.has(k.path)) {
      const existing = keyMap.get(k.path)
      duplicates.push({
        path: k.path,
        first: { line: existing.line, isObject: existing.isObject },
        second: { line: k.line, isObject: k.isObject }
      })
    } else {
      keyMap.set(k.path, k)
    }
  }

  return duplicates
}

async function main() {
  console.log('🔍 开始检查 i18n keys...\n')

  // 1. 加载所有 locale 文件
  const localeFiles = ['zh-CN.json', 'en-US.json']
  const locales = {}
  for (const file of localeFiles) {
    const path = join(localesDir, file)
    if (existsSync(path)) {
      locales[file] = JSON.parse(readFileSync(path, 'utf-8'))
    }
  }

  // 2. 扫描源码提取 t() keys
  const srcDir = join(webRoot, 'src')
  const sourceFiles = getAllFiles(srcDir, '.tsx')
  const allTKeys = new Map() // key -> { files, usesReturnObjects }

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf-8')
    const keys = extractTKeys(content)
    for (const { key, usesReturnObjects } of keys) {
      if (!allTKeys.has(key)) {
        allTKeys.set(key, { files: [], usesReturnObjects })
      }
      allTKeys.get(key).files.push(relative(webRoot, file))
      // 如果任何一处使用 returnObjects，标记为 true
      if (usesReturnObjects) {
        allTKeys.get(key).usesReturnObjects = true
      }
    }
  }

  console.log(`📊 统计：共 ${allTKeys.size} 个 unique t() keys，扫描 ${sourceFiles.length} 个文件\n`)

  // 3. 检查问题
  const problems = []

  for (const [key, { files, usesReturnObjects }] of allTKeys) {
    for (const [localeName, localeObj] of Object.entries(locales)) {
      const result = checkKeyType(localeObj, key)

      if (!result.exists) {
        if (result.type === 'missing') {
          problems.push({
            type: 'missing',
            key,
            locale: localeName,
            files
          })
        }
      } else if (result.type === 'object') {
        // t('key') 期望返回字符串，但实际返回对象
        // 如果使用了 returnObjects: true，这是预期行为，不报错
        if (!usesReturnObjects) {
          problems.push({
            type: 'returns-object',
            key,
            locale: localeName,
            files
          })
        }
      }
    }
  }

  // 4. 检查重复键定义
  console.log('🔎 检查 JSON 文件中的重复键定义...\n')
  for (const file of localeFiles) {
    const path = join(localesDir, file)
    const duplicates = findDuplicateKeys(path)
    if (duplicates.length > 0) {
      console.log(`❌ ${file} 发现重复键定义：`)
      for (const d of duplicates) {
        console.log(`   - "${d.path}"`)
        console.log(`     第 ${d.first.line} 行 (${d.first.isObject ? '对象' : '字符串'})`)
        console.log(`     第 ${d.second.line} 行 (${d.second.isObject ? '对象' : '字符串'})`)
      }
      console.log('')
    } else {
      console.log(`✅ ${file} 无重复键定义`)
    }
  }

  // 5. 输出问题报告
  if (problems.length > 0) {
    console.log('\n❌ 发现以下问题：\n')

    // 按 problem type 分组
    const missingKeys = problems.filter(p => p.type === 'missing')
    const objectKeys = problems.filter(p => p.type === 'returns-object')

    if (objectKeys.length > 0) {
      console.log('🔴 返回对象而非字符串（可能导致 "returned an object instead of string" 错误）：')
      for (const p of objectKeys) {
        console.log(`   - t('${p.key}') 在 ${p.locale} 返回对象`)
        console.log(`     使用位置：${p.files.slice(0, 3).join(', ')}${p.files.length > 3 ? '...' : ''}`)
      }
      console.log('')
    }

    if (missingKeys.length > 0) {
      console.log('🟡 缺失的 keys：')
      for (const p of missingKeys.slice(0, 20)) { // 只显示前20个
        console.log(`   - t('${p.key}') 在 ${p.locale} 不存在`)
      }
      if (missingKeys.length > 20) {
        console.log(`   ... 还有 ${missingKeys.length - 20} 个缺失的 key`)
      }
      console.log('')
    }

    console.log(`\n📈 总计：${objectKeys.length} 个对象类型问题，${missingKeys.length} 个缺失问题\n`)
  } else {
    console.log('\n✅ 所有 t() keys 检查通过！\n')
  }
}

main().catch(console.error)