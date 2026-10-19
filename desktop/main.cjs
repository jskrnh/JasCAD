// jasCAD desktop shell (Electron). Serves the built web app over a private secure scheme
// so module workers, WebAssembly and WebHID (SpaceMouse) all work offline.
const { app, BrowserWindow, protocol, net, session, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'forge', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = path.join(__dirname, 'web');
const VENDORS = [0x256f, 0x046d]; // 3Dconnexion

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    title: 'jasCAD', backgroundColor: '#f3f4f6', show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('forge://app/index.html');
}

app.whenReady().then(() => {
  protocol.handle('forge', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // SpaceMouse: grant 3Dconnexion HID devices without a browser chooser.
  const ses = session.defaultSession;
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const d = details.deviceList.find((x) => VENDORS.includes(x.vendorId));
    callback(d ? d.deviceId : '');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid' || permission === 'clipboard-sanitized-write');
  ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && VENDORS.includes(d.device.vendorId));

  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
