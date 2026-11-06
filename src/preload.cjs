'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const names=['listGames','getGame','expandLinks','checkLinks','addDownloads','getState','downloadAction','chooseFolder','saveSettings','openExternal','openDownloadsFolder','copyText','sendToJDownloader','exportLinks','openHost','getCatalogSections','listCatalog','getGameResources','openGameplay','getInstalledGames','scanInstalledGames','addGameFolder','openInstalledFolder','setCompletionAction','cancelCompletionAction'];
const api=Object.fromEntries(names.map(name=>[name,(value)=>ipcRenderer.invoke('atlas:'+name,value)]));
api.onState=callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('atlas:state',listener);return()=>ipcRenderer.removeListener('atlas:state',listener);};
contextBridge.exposeInMainWorld('atlas',api);
