const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs').promises
const { promisify } = require('util')
const childProcess = require('child_process')
const exec = promisify(childProcess.exec)

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.js    > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.DIST_ELECTRON = path.join(__dirname, '..')
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist')
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

let win
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// 获取文件夹大小
async function getDirSize(dirPath) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stdout } = await exec(`du -sk "${dirPath}"`)
      const size = parseInt(stdout.split('\t')[0]) * 1024 // 转换为字节
      return size
    } else {
      // Windows 平台使用递归计算
      let size = 0
      const files = await fs.readdir(dirPath)
      for (const file of files) {
        const filePath = path.join(dirPath, file)
        const stats = await fs.stat(filePath)
        if (stats.isDirectory()) {
          size += await getDirSize(filePath)
        } else {
          size += stats.size
        }
      }
      return size
    }
  } catch (error) {
    console.error(`Error getting size for ${dirPath}:`, error)
    return 0
  }
}

// 递归扫描目录
async function scanDirectory(dirPath) {
  const results = {
    nodeModules: [],
    targets: []
  }

  async function scan(currentPath) {
    try {
      const files = await fs.readdir(currentPath)
      
      for (const file of files) {
        if (file === '.git' || file === '.idea') continue // 跳过这些目录
        
        const fullPath = path.join(currentPath, file)
        const stats = await fs.stat(fullPath)
        
        if (stats.isDirectory()) {
          if (file === 'node_modules') {
            const size = await getDirSize(fullPath)
            results.nodeModules.push({
              path: fullPath,
              size: size,
              name: path.basename(path.dirname(fullPath)) // 获取父目录名
            })
          } else if (file === 'target') {
            const size = await getDirSize(fullPath)
            results.targets.push({
              path: fullPath,
              size: size,
              name: path.basename(path.dirname(fullPath)) // 获取父目录名
            })
          } else {
            await scan(fullPath)
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning ${currentPath}:`, error)
    }
  }

  await scan(dirPath)
  return results
}

// 删除文件夹
async function deleteDirectory(dirPath) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      await exec(`rm -rf "${dirPath}"`)
    } else {
      // Windows 平台使用 rd 命令
      await exec(`rd /s /q "${dirPath}"`)
    }
    return true
  } catch (error) {
    console.error(`Error deleting directory ${dirPath}:`, error)
    throw error
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '../dist-electron/preload/index.js'),
    },
  })

  // 配置窗口加载
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(process.env.DIST, 'index.html'))
  }
}

// 监听选择目录的 IPC 事件
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: '选择工作目录',
  })
  return result
})

// 监听扫描目录的 IPC 事件
ipcMain.handle('scan-directory', async (event, dirPath) => {
  try {
    return await scanDirectory(dirPath)
  } catch (error) {
    console.error('Scan error:', error)
    throw error
  }
})

// 监听删除文件夹的 IPC 事件
ipcMain.handle('delete-directory', async (event, dirPath) => {
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      title: '确认删除',
      message: '确定要删除这个文件夹吗？此操作不可恢复！',
      detail: dirPath,
      buttons: ['取消', '删除'],
      defaultId: 0,
      cancelId: 0,
    })

    if (result.response === 1) {
      await deleteDirectory(dirPath)
      return true
    }
    return false
  } catch (error) {
    console.error('Delete error:', error)
    throw error
  }
})

// 监听批量删除文件夹的 IPC 事件
ipcMain.handle('delete-directories', async (event, dirPaths) => {
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      title: '确认批量删除',
      message: `确定要删除这 ${dirPaths.length} 个文件夹吗？此操作不可恢复！`,
      detail: dirPaths.join('\n'),
      buttons: ['取消', '删除'],
      defaultId: 0,
      cancelId: 0,
    })

    if (result.response === 1) {
      const results = await Promise.allSettled(dirPaths.map(dirPath => deleteDirectory(dirPath)))
      return results.map((result, index) => ({
        path: dirPaths[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason.message : null
      }))
    }
    return []
  } catch (error) {
    console.error('Batch delete error:', error)
    throw error
  }
})

// 监听打开外部链接的 IPC 事件
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url)
    return true
  } catch (error) {
    console.error('Open external error:', error)
    throw error
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow) 