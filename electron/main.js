const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
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

// 设置应用图标路径
function getIconPath() {
  if (app.isPackaged) {
    // 打包后的路径
    return path.join(process.resourcesPath, 'app.asar.unpacked/src/assets/logo.png')
  }
  // 开发环境路径
  return path.join(__dirname, '../src/assets/logo.png')
}

// 确保图标文件存在
function ensureIconExists(iconPath) {
  try {
    if (require('fs').existsSync(iconPath)) {
      return iconPath
    }
    console.warn(`Icon not found at ${iconPath}, trying alternative path...`)
    // 尝试备选路径
    const altPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked/dist/assets/logo.png')
      : path.join(__dirname, '../dist/assets/logo.png')
    
    if (require('fs').existsSync(altPath)) {
      return altPath
    }
    console.error('Icon not found in any location')
    return null
  } catch (error) {
    console.error('Error checking icon path:', error)
    return null
  }
}

const iconPath = ensureIconExists(getIconPath())

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
    title: 'IDEA Projects Cleaner',
    icon: iconPath,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload/index.js'),
      devTools: true // 确保开发者工具可用
    },
  })

  // 设置 Dock 图标 (仅在 macOS)
  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath)
    app.name = 'IDEA Cleaner'

    // 创建 macOS 菜单
    const template = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ]
      },
      {
        role: 'help',
        submenu: [
          {
            label: '访问 GitHub',
            click: async () => {
              await shell.openExternal('https://github.com/xiaoming728/idea-cleaner')
            }
          }
        ]
      }
    ]
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }

  // 配置窗口加载
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // 生产环境加载
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 添加错误处理
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
    if (!VITE_DEV_SERVER_URL) {
      win.loadFile(path.join(__dirname, '../dist/index.html'))
    }
  })

  // 添加键盘快捷键
  win.webContents.on('before-input-event', (event, input) => {
    // Command + Option + I 打开开发者工具 (macOS)
    if (process.platform === 'darwin' && input.key === 'i' && input.meta && input.alt) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
    // Ctrl + Shift + I 打开开发者工具 (Windows/Linux)
    else if (input.key === 'I' && input.control && input.shift) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  // 设置窗口标题
  win.setTitle('IDEA Projects Cleaner')

  // 添加页面加载完成的处理
  win.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully')
  })

  // 添加渲染进程错误处理
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('Render process gone:', details)
  })

  win.webContents.on('crashed', () => {
    console.error('Renderer process crashed')
  })
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
      message: `确定要删除选中的 ${dirPaths.length} 个文件夹吗？`,
      detail: '此操作不可恢复！请确保已备份重要数据。',
      buttons: ['取消', '删除'],
      defaultId: 0,
      cancelId: 0,
    })

    if (result.response === 1) {
      const total = dirPaths.length
      const results = []
      
      for (let i = 0; i < dirPaths.length; i++) {
        try {
          await deleteDirectory(dirPaths[i])
          results.push({ path: dirPaths[i], success: true })
        } catch (error) {
          results.push({ path: dirPaths[i], success: false, error: error.message })
        }
        
        // 发送进度更新
        const progress = Math.round(((i + 1) / total) * 100)
        win.webContents.send('delete-progress', progress)
      }
      
      return results
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