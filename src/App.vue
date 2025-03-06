<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Search, Delete, RefreshRight, Loading } from '@element-plus/icons-vue'

// 声明 electron 对象
const electron = window.electron

// 定义响应式变量
const workspacePath = ref('')
const scanning = ref(false)
const scanResults = ref({
  nodeModules: [],
  targets: []
})
const selectedRows = ref([])
const deleting = ref(false)
const deleteProgress = ref(0)

// 计算属性：所有结果
const allResults = computed(() => {
  return [
    ...scanResults.value.nodeModules.map(item => ({ ...item, type: 'node_modules' })),
    ...scanResults.value.targets.map(item => ({ ...item, type: 'target' }))
  ]
})

// 计算属性：总大小
const totalSize = computed(() => {
  return allResults.value.reduce((sum, item) => sum + item.size, 0)
})

// 格式化文件大小
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

// 选择工作目录
const selectWorkspace = async () => {
  try {
    const result = await electron.ipcRenderer.invoke('select-directory')
    if (result.canceled) return
    workspacePath.value = result.filePaths[0]
  } catch (error) {
    ElMessage.error('选择目录失败：' + error.message)
  }
}

// 开始扫描
const startScan = async () => {
  if (!workspacePath.value) {
    ElMessage.warning('请先选择工作目录')
    return
  }

  scanning.value = true
  selectedRows.value = [] // 重置选择
  try {
    const results = await electron.ipcRenderer.invoke('scan-directory', workspacePath.value)
    scanResults.value = results
    ElMessage.success('扫描完成')
  } catch (error) {
    ElMessage.error('扫描失败：' + error.message)
  } finally {
    scanning.value = false
  }
}

// 处理删除操作
const handleDelete = async (row) => {
  try {
    const success = await electron.ipcRenderer.invoke('delete-directory', row.path)
    if (success) {
      ElMessage.success('删除成功')
      // 从结果中移除
      if (row.type === 'node_modules') {
        scanResults.value.nodeModules = scanResults.value.nodeModules.filter(item => item.path !== row.path)
      } else {
        scanResults.value.targets = scanResults.value.targets.filter(item => item.path !== row.path)
      }
    }
  } catch (error) {
    ElMessage.error('删除失败：' + error.message)
  }
}

// 处理批量删除
const handleBatchDelete = async () => {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先选择要删除的文件夹')
    return
  }

  try {
    const paths = selectedRows.value.map(row => row.path)
    deleting.value = true
    deleteProgress.value = 0
    
    const results = await electron.ipcRenderer.invoke('delete-directories', paths)
    
    // 处理删除结果
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    if (successCount > 0) {
      // 从结果中移除成功删除的项
      const successPaths = new Set(results.filter(r => r.success).map(r => r.path))
      scanResults.value.nodeModules = scanResults.value.nodeModules.filter(item => !successPaths.has(item.path))
      scanResults.value.targets = scanResults.value.targets.filter(item => !successPaths.has(item.path))
      selectedRows.value = [] // 清空选择
    }

    if (failCount > 0) {
      ElMessage.warning(`${successCount} 个文件夹删除成功，${failCount} 个删除失败`)
    } else {
      ElMessage.success(`成功删除 ${successCount} 个文件夹`)
    }
  } catch (error) {
    ElMessage.error('批量删除失败：' + error.message)
  } finally {
    deleting.value = false
    deleteProgress.value = 0
  }
}

// 表格选择变化处理
const handleSelectionChange = (rows) => {
  selectedRows.value = rows
}

// 打开博客链接
const openBlog = async () => {
  try {
    await electron.ipcRenderer.invoke('open-external', 'https://xiaoming728.com')
  } catch (error) {
    ElMessage.error('打开链接失败：' + error.message)
  }
}

// 打开 GitHub 链接
const openGithub = async () => {
  try {
    await electron.ipcRenderer.invoke('open-external', 'https://github.com/xiaoming728/idea-cleaner')
  } catch (error) {
    ElMessage.error('打开 GitHub 链接失败：' + error.message)
  }
}

// 添加进度监听
const progressHandler = (progress) => {
  deleteProgress.value = progress
}

onMounted(() => {
  electron.ipcRenderer.on('delete-progress', progressHandler)
})

onUnmounted(() => {
  electron.ipcRenderer.off('delete-progress', progressHandler)
})
</script>

<template>
  <div class="app-container dark">
    <el-container>
      <el-aside width="260px" class="app-sidebar">
        <div class="sidebar-header">
          <img src="@/assets/logo.svg" alt="IDEA Cleaner" class="app-logo" />
          <h1>IDEA Cleaner</h1>
        </div>
        <div class="sidebar-content">
          <div class="workspace-selector">
            <p class="section-title">工作目录</p>
            <el-input
              v-model="workspacePath"
              placeholder="选择工作目录"
              :readonly="true"
              size="large"
              class="directory-input"
            >
              <template #append>
                <el-button @click="selectWorkspace" style="width: 80px;"
                >
                  <el-icon><Folder /></el-icon>
                </el-button>
              </template>
            </el-input>
          </div>

          <div class="stats-panel">
            <p class="section-title">统计信息</p>
            <div class="stat-card">
              <div class="stat-label">总大小</div>
              <div class="stat-value">{{ formatSize(totalSize) }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">项目数量</div>
              <div class="stat-value">{{ allResults.length }}</div>
            </div>
          </div>

          <div class="action-panel">
            <el-button 
              type="primary" 
              @click="startScan" 
              :loading="scanning" 
              size="large"
              class="scan-button"
            >
              <el-icon class="el-icon"><Search /></el-icon>
              <span class="button-text">扫描目录</span>
            </el-button>
          </div>
          <div class="action-panel">
            <el-button
              type="danger"
              :disabled="!selectedRows.length || deleting"
              @click="handleBatchDelete"
              size="large"
              class="delete-button"
            >
              <template v-if="!deleting">
                <el-icon class="el-icon"><Delete /></el-icon>
                <span class="button-text">批量删除 ({{ selectedRows.length }})</span>
              </template>
              <template v-else>
                <el-icon class="el-icon is-loading"><Loading /></el-icon>
                <span class="button-text">正在删除 ({{ deleteProgress }}%)</span>
              </template>
            </el-button>
          </div>
        </div>
      </el-aside>

      <el-container class="main-container">
        <el-header class="main-header">
          <div class="header-content">
            <div class="breadcrumb">
              {{ workspacePath || '未选择目录' }}
            </div>
            <div class="header-actions">
              <a 
                href="https://xiaoming728.com" 
                target="_blank" 
                class="blog-link"
                @click.prevent="openBlog"
              >
                <el-avatar
                  :size="32"
                  src="https://xiaoming728.com/upload/logo.jpg"
                  class="avatar"
                />
              </a>
              <a 
                href="https://github.com/xiaoming728/idea-cleaner" 
                target="_blank" 
                class="github-link"
                @click.prevent="openGithub"
              >
                <el-avatar
                  :size="32"
                  src="https://github.githubassets.com/assets/GitHub-Mark-ea2971cee799.png"
                  class="avatar"
                />
              </a>
            </div>
          </div>
        </el-header>

        <el-main class="main-content">
          <div v-if="!allResults.length" class="empty-state">
            <el-icon class="empty-icon"><Search /></el-icon>
            <p class="empty-text">选择目录并点击扫描开始清理</p>
          </div>

          <el-table
            v-else
            :data="allResults"
            style="width: 100%"
            border
            @selection-change="handleSelectionChange"
            class="result-table"
          >
            <el-table-column type="selection" width="55" />
            <el-table-column prop="name" label="项目名称" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="project-name">
                  <span class="name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="path" label="路径" min-width="250" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="path-cell">
                  <span class="path">{{ row.path }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="125">
              <template #default="{ row }">
                <el-tag 
                  :type="row.type === 'node_modules' ? 'warning' : 'danger'"
                  class="type-tag"
                >
                  {{ row.type }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="size" label="大小" width="120" align="right">
              <template #default="{ row }">
                <span class="size-text">{{ formatSize(row.size) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button 
                  type="danger" 
                  :icon="Delete" 
                  circle
                  @click="handleDelete(row)"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<style>
:root {
  --primary-bg: #1a1a1a;
  --secondary-bg: #242424;
  --header-bg: #2d2d2d;
  --border-color: #333;
  --text-primary: #ffffff;
  --text-secondary: #999;
  --accent-color: #409EFF;
  --danger-color: #F56C6C;
  --warning-color: #E6A23C;
  --success-color: #67C23A;
  --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

html, body {
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
  background-color: var(--primary-bg);
  color: var(--text-primary);
}

#app {
  height: 100vh;
}

.app-container {
  height: 100vh;
  background-color: var(--primary-bg);
}

/* 侧边栏样式 */
.app-sidebar {
  background-color: var(--secondary-bg);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-logo {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.sidebar-header h1 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-content {
  padding: 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-title {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 统计卡片样式 */
.stats-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat-card {
  background-color: var(--header-bg);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid var(--border-color);
}

.stat-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 1.2rem;
  color: var(--text-primary);
  font-weight: 600;
}

/* 主内容区域样式 */
.main-container {
  background-color: var(--primary-bg);
}

.main-header {
  background-color: var(--header-bg);
  border-bottom: 1px solid var(--border-color);
  height: 60px !important;
  line-height: 60px;
  padding: 0 24px !important;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
}

.breadcrumb {
  color: var(--text-secondary);
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.main-content {
  padding: 24px;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-text {
  font-size: 1.1rem;
}

/* 表格样式 */
.result-table {
  background-color: var(--secondary-bg);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.project-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.path-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.path {
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-tag {
  border-radius: 4px;
  padding: 2px 8px;
  text-transform: lowercase;
}

.size-text {
  font-family: monospace;
  font-size: 0.9rem;
}

/* Element Plus 暗色主题覆盖 */
.dark {
  --el-bg-color: var(--secondary-bg);
  --el-bg-color-overlay: var(--header-bg);
  --el-text-color-primary: var(--text-primary);
  --el-text-color-regular: var(--text-secondary);
  --el-border-color: var(--border-color);
  --el-border-color-light: var(--border-color);
  --el-border-color-lighter: var(--border-color);
  --el-fill-color-blank: var(--secondary-bg);
  --el-button-size-large: 40px;
}

.el-button {
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  line-height: 1;
  margin: 0;
}

.el-button--large {
  height: 40px;
  padding: 0 20px;
  font-size: 14px;
  margin: 0;
}

.el-button .el-icon {
  font-size: 16px;
  margin: 0;
}

.el-input {
  --el-input-bg-color: var(--header-bg);
  border-radius: 8px;
}

.el-input-group__append {
  padding: 0;
  border: none;
  background-color: var(--el-button-bg-color);
}

.el-input-group__append button {
  border: none;
  height: 100%;
  border-radius: 0 8px 8px 0;
  background-color: var(--header-bg);
  color: var(--text-primary);
}

.el-input-group__append button:hover {
  background-color: var(--el-button-hover-bg-color);
  color: var(--text-primary);
}

.el-table {
  --el-table-border-color: var(--border-color);
  --el-table-header-bg-color: var(--header-bg);
  --el-table-row-hover-bg-color: var(--header-bg);
}

.el-table th.el-table__cell {
  background-color: var(--header-bg);
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
}

.el-card {
  background-color: var(--secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

/* 按钮样式 */
.action-panel {
  display: flex;
  flex-direction: column;
  margin-bottom: -10px;
}

.scan-button,
.delete-button {
  width: 100%;
  justify-content: center;
  height: 40px !important;
  padding: 0 20px !important;
  margin: 0;
}

.button-text {
  line-height: 1;
  display: inline-block;
  vertical-align: middle;
}

.el-button.is-disabled {
  opacity: 0.7;
}

.el-button.is-disabled:hover {
  opacity: 0.7;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--secondary-bg);
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.refresh-button {
  margin-right: 4px;
}

.blog-link {
  display: flex;
  align-items: center;
  text-decoration: none;
  transition: opacity 0.2s;
}

.blog-link:hover {
  opacity: 0.8;
}

.avatar {
  border: 2px solid var(--border-color);
  transition: border-color 0.2s;
}

.blog-link:hover .avatar {
  border-color: var(--accent-color);
}

.github-link {
  display: flex;
  align-items: center;
  text-decoration: none;
  transition: opacity 0.2s;
}

.github-link:hover {
  opacity: 0.8;
}

.github-link .avatar {
  border: 2px solid var(--border-color);
  transition: border-color 0.2s;
}

.github-link:hover .avatar {
  border-color: var(--accent-color);
}
</style>
