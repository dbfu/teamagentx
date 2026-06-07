/**
 * 清理 JSON locale 文件中的重复键定义
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const localesDir = '/Users/fudebao/Documents/projects/team-agent-x/apps/web/src/i18n/locales'

// 重复键：保留第一个定义，删除后面的
// 格式：{ key: [firstLine, secondLine] }
const duplicates = {
  'zh-CN.json': {
    'chat.groupRules': [161, 210],
    'chat.groupSettings': [162, 213],
    'chat.duration': [260, 411],
    'chat.voiceInput': [232, 423],
    'chat.deleteMessage': [414, 427],
    'chat.processing': [285, 436],
    'chat.noMessages': [248, 442],
    'chat.taskBoardTitle': [206, 450],
    'assistant.createCategory': [728, 744],
    'model.exportAll': [969, 1084],
    'model.addModel': [1010, 1086],
    'skill.noMatchingSkills': [1152, 1192],
    'skill.noDescription': [1153, 1193],
    'skill.sourceUserCreated': [1154, 1194],
    'skill.sourceExternal': [1155, 1196],
    'integration.deleteBot': [1767, 1787],
    'cron.executionContent': [1884, 1933],
    'office.agentsCount': [1663, 2056],
    'office.returnToChat': [1660, 2057],
    'office.socketDisconnected': [1666, 2082],
    'office.executionDetail': [1677, 2088],
  },
  'en-US.json': {
    'chat.groupRules': [161, 210],
    'chat.groupSettings': [162, 213],
    'chat.duration': [260, 411],
    'chat.voiceInput': [232, 423],
    'chat.deleteMessage': [414, 427],
    'chat.processing': [285, 436],
    'chat.noMessages': [248, 442],
    'chat.taskBoardTitle': [206, 450],
    'model.exportAll': [960, 1075],
    'model.addModel': [1001, 1077],
    'skill.noMatchingSkills': [1143, 1183],
    'skill.noDescription': [1144, 1184],
    'skill.sourceUserCreated': [1145, 1185],
    'skill.sourceExternal': [1146, 1187],
    'integration.deleteBot': [1756, 1776],
    'cron.executionContent': [1873, 1922],
    'office.agentsCount': [1654, 2045],
    'office.returnToChat': [1651, 2046],
    'office.socketDisconnected': [1657, 2071],
    'office.executionDetail': [1668, 2077],
  }
}

function cleanFile(filename, duplicatesInfo) {
  const filepath = join(localesDir, filename)
  let content = readFileSync(filepath, 'utf-8')
  const lines = content.split('\n')

  // 收集要删除的行号（第二个定义）
  const linesToRemove = new Set()
  for (const [key, [first, second]] of Object.entries(duplicatesInfo)) {
    linesToRemove.add(second)
  }

  // 按行号降序排序，从后往前删除避免行号变化
  const sortedLines = [...linesToRemove].sort((a, b) => b - a)

  console.log(`\n清理 ${filename}:`)
  for (const lineNum of sortedLines) {
    const line = lines[lineNum - 1]
    console.log(`  删除第 ${lineNum} 行: ${line.trim().substring(0, 50)}...`)

    // 检查上一行是否有逗号（处理 JSON 格式）
    const prevLine = lines[lineNum - 2]
    if (prevLine && prevLine.trim().endsWith(',')) {
      // 如果上一行有逗号，当前行是正常的键值对，直接删除当前行
      lines.splice(lineNum - 1, 1)
    } else {
      // 当前行可能是块的最后一行，需要特殊处理
      // 检查当前行是否以逗号结尾
      if (line.trim().endsWith(',')) {
        // 当前行有逗号，删除后需要给上一行加逗号
        lines.splice(lineNum - 1, 1)
        const newPrevLine = lines[lineNum - 2]
        if (newPrevLine && !newPrevLine.trim().endsWith(',') && !newPrevLine.trim().endsWith('{') && !newPrevLine.trim().endsWith('[')) {
          lines[lineNum - 2] = newPrevLine.rstrip ? newPrevLine.rstrip('\n') + ',\n' : newPrevLine.replace(/\n$/, '') + ',\n'
        }
      } else {
        // 当前行没有逗号，直接删除
        lines.splice(lineNum - 1, 1)
        // 检查上一行是否有多余的逗号需要移除
        const newPrevLine = lines[lineNum - 2]
        if (newPrevLine && newPrevLine.trim().endsWith(',')) {
          lines[lineNum - 2] = newPrevLine.replace(/,\n$/, '\n')
        }
      }
    }
  }

  // 写回文件
  writeFileSync(filepath, lines.join('\n'))
  console.log(`  ✅ 已清理 ${sortedLines.length} 个重复键`)
}

// 执行清理
for (const [filename, duplicatesInfo] of Object.entries(duplicates)) {
  cleanFile(filename, duplicatesInfo)
}

console.log('\n✅ 清理完成！')