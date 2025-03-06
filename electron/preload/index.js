const { contextBridge, ipcRenderer } = require('electron')

// 预加载脚本运行在具有 Node.js 和 Electron API 访问权限的环境中
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => {
      const validChannels = [
        'select-directory',
        'scan-directory',
        'delete-directory',
        'delete-directories',
        'open-external'
      ]
      if (!validChannels.includes(channel)) {
        throw new Error(`Unauthorized IPC channel: ${channel}`)
      }
      return ipcRenderer.invoke(channel, ...args)
    },
    on: (channel, callback) => {
      const validChannels = ['delete-progress']
      if (!validChannels.includes(channel)) {
        throw new Error(`Unauthorized IPC channel: ${channel}`)
      }
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    },
    off: (channel, callback) => {
      const validChannels = ['delete-progress']
      if (!validChannels.includes(channel)) {
        throw new Error(`Unauthorized IPC channel: ${channel}`)
      }
      ipcRenderer.off(channel, callback)
    }
  },
}) 