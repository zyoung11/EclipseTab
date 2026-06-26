import { storage } from './storage';
import { createZip, readJsonEntry, readZip, textEntry } from './zip';
import { db, FaviconItem, WallpaperItem } from './db';
import { FAVICON_PREFIX, getDomainFromRef } from '@/features/dock/utils/iconCache';
import { DockItem, Sticker } from '@/shared/types';
import packageInfo from '../../../package.json';

type BackupManifest = {
  type: 'monster-tab-backup';
  version: 1;
  appVersion: string;
  exportedAt: string;
};

type AssetRef = {
  path: string;
  type: string;
};

type FaviconAssetRef = AssetRef & {
  domain: string;
  isFallback: boolean;
  iconSmall?: boolean;
  lastUpdated?: number;
};

type StickerImageAssetRef = AssetRef & {
  id: string;
};

type WallpaperAssetRef = AssetRef & {
  id: string;
  createdAt: number;
  wallpaperType?: 'image' | 'video';
  thumbnailPath?: string;
  thumbnailType?: string;
};

type BackupData = {
  spaces: ReturnType<typeof storage.getSpaces>;
  config: ReturnType<typeof storage.getConfig>;
  searchEngine: ReturnType<typeof storage.getSearchEngine>;
  wallpaperId: string | null;
  language: string | null;
  stickers: Sticker[];
  deletedStickers: Sticker[];
  stickerImagesMigrated: boolean;
  assets: {
    favicons: FaviconAssetRef[];
    stickerImages: StickerImageAssetRef[];
    wallpaper: WallpaperAssetRef | null;
  };
};

const blobToBytes = async (blob: Blob): Promise<Uint8Array> => {
  return new Uint8Array(await blob.arrayBuffer());
};

const bytesToBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const extensionFromType = (type: string, fallback = 'bin'): string => {
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('svg')) return 'svg';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('webm')) return 'webm';
  if (type.includes('icon')) return 'ico';
  return fallback;
};

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_');

const collectFaviconDomains = (items: DockItem[], domains = new Set<string>()): Set<string> => {
  for (const item of items) {
    if (item.icon?.startsWith(FAVICON_PREFIX)) {
      domains.add(getDomainFromRef(item.icon));
    }
    if (item.type === 'folder' && item.items) {
      collectFaviconDomains(item.items, domains);
    }
  }
  return domains;
};

const collectStickerImageIds = (stickers: Sticker[], ids = new Set<string>()): Set<string> => {
  for (const sticker of stickers) {
    if (sticker.type === 'image' && sticker.content && !sticker.content.startsWith('data:')) {
      ids.add(sticker.content);
    }
  }
  return ids;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportFullBackup(): Promise<void> {
  const spaces = storage.getSpaces();
  const config = storage.getConfig();
  const searchEngine = storage.getSearchEngine();
  const wallpaperId = storage.getWallpaperId();
  const stickers = storage.getStickers();
  const deletedStickers = storage.getDeletedStickers();

  const entries: { path: string; data: Uint8Array }[] = [];
  const faviconAssets: FaviconAssetRef[] = [];
  const stickerImageAssets: StickerImageAssetRef[] = [];
  let wallpaperAsset: WallpaperAssetRef | null = null;

  const faviconDomains = new Set<string>();
  for (const space of spaces.spaces) {
    collectFaviconDomains(space.apps, faviconDomains);
  }

  for (const domain of faviconDomains) {
    const item = await db.getFavicon(domain);
    if (!item?.data) continue;

    const ext = extensionFromType(item.data.type, 'ico');
    const path = `assets/favicons/${safeName(domain)}.${ext}`;
    entries.push({ path, data: await blobToBytes(item.data) });
    faviconAssets.push({
      path,
      domain,
      type: item.data.type || 'image/png',
      isFallback: item.isFallback,
      iconSmall: item.iconSmall,
      lastUpdated: item.lastUpdated,
    });
  }

  const stickerImageIds = collectStickerImageIds(stickers);
  collectStickerImageIds(deletedStickers, stickerImageIds);

  for (const id of stickerImageIds) {
    const item = await db.getStickerImage(id);
    if (!item?.data) continue;

    const ext = extensionFromType(item.data.type, 'png');
    const path = `assets/stickers/${safeName(id)}.${ext}`;
    entries.push({ path, data: await blobToBytes(item.data) });
    stickerImageAssets.push({ path, id, type: item.data.type || 'image/png' });
  }

  if (wallpaperId) {
    const item = await db.get(wallpaperId);
    if (item?.data) {
      const ext = extensionFromType(item.data.type, item.type === 'video' ? 'mp4' : 'png');
      const path = `assets/wallpaper/${safeName(item.id)}.${ext}`;
      entries.push({ path, data: await blobToBytes(item.data) });

      let thumbnailPath: string | undefined;
      let thumbnailType: string | undefined;
      if (item.thumbnail) {
        thumbnailType = item.thumbnail.type || 'image/png';
        thumbnailPath = `assets/wallpaper/${safeName(item.id)}-thumb.${extensionFromType(thumbnailType, 'png')}`;
        entries.push({ path: thumbnailPath, data: await blobToBytes(item.thumbnail) });
      }

      wallpaperAsset = {
        path,
        id: item.id,
        type: item.data.type || 'application/octet-stream',
        createdAt: item.createdAt,
        wallpaperType: item.type,
        thumbnailPath,
        thumbnailType,
      };
    }
  }

  const manifest: BackupManifest = {
    type: 'monster-tab-backup',
    version: 1,
    appVersion: packageInfo.version,
    exportedAt: new Date().toISOString(),
  };

  const data: BackupData = {
    spaces,
    config,
    searchEngine,
    wallpaperId,
    language: localStorage.getItem('app_language'),
    stickers,
    deletedStickers,
    stickerImagesMigrated: storage.isStickerImagesMigrated(),
    assets: {
      favicons: faviconAssets,
      stickerImages: stickerImageAssets,
      wallpaper: wallpaperAsset,
    },
  };

  const zip = createZip([
    textEntry('manifest.json', manifest),
    textEntry('data.json', data),
    ...entries,
  ]);

  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(zip, `monster-tab-backup-${date}.zip`);
}

export async function importFullBackup(file: File): Promise<void> {
  const entries = await readZip(file);
  const manifest = readJsonEntry<BackupManifest>(entries, 'manifest.json');
  const data = readJsonEntry<BackupData>(entries, 'data.json');

  if (manifest.type !== 'monster-tab-backup' || manifest.version !== 1) {
    throw new Error('Unsupported backup file');
  }
  if (!data.spaces?.spaces || !Array.isArray(data.spaces.spaces)) {
    throw new Error('Invalid backup data');
  }

  await db.clearAllFavicons();
  await db.clearAllStickerImages();

  const oldWallpapers = await db.getAll();
  if (oldWallpapers.length > 0) {
    await db.removeMultiple(oldWallpapers.map(item => item.id));
  }

  for (const asset of data.assets?.favicons || []) {
    const bytes = entries.get(asset.path);
    if (!bytes) continue;
    const item: FaviconItem = {
      domain: asset.domain,
      data: new Blob([bytesToBlobPart(bytes)], { type: asset.type || 'image/png' }),
      isFallback: asset.isFallback,
      iconSmall: asset.iconSmall,
      lastUpdated: asset.lastUpdated,
    };
    await db.saveFavicon(item);
  }

  for (const asset of data.assets?.stickerImages || []) {
    const bytes = entries.get(asset.path);
    if (!bytes) continue;
    await db.saveStickerImage({
      id: asset.id,
      data: new Blob([bytesToBlobPart(bytes)], { type: asset.type || 'image/png' }),
    });
  }

  if (data.assets?.wallpaper) {
    const asset = data.assets.wallpaper;
    const bytes = entries.get(asset.path);
    if (bytes) {
      let thumbnail: Blob | undefined;
      if (asset.thumbnailPath) {
        const thumbnailBytes = entries.get(asset.thumbnailPath);
        if (thumbnailBytes) {
          thumbnail = new Blob([bytesToBlobPart(thumbnailBytes)], { type: asset.thumbnailType || 'image/png' });
        }
      }

      const item: WallpaperItem = {
        id: asset.id,
        data: new Blob([bytesToBlobPart(bytes)], { type: asset.type || 'application/octet-stream' }),
        thumbnail,
        createdAt: asset.createdAt || Date.now(),
        type: asset.wallpaperType,
      };
      await db.save(item);
    }
  }

  storage.saveSpaces(data.spaces);
  storage.saveConfig(data.config);
  storage.saveWallpaperId(data.wallpaperId || null);
  storage.saveStickers(data.stickers || []);
  storage.saveDeletedStickers(data.deletedStickers || []);

  if (data.searchEngine) {
    storage.saveSearchEngine(data.searchEngine);
  } else {
    localStorage.removeItem('MonsterTab_searchEngine');
  }

  if (data.language === 'en' || data.language === 'zh') {
    localStorage.setItem('app_language', data.language);
  }

  if (data.stickerImagesMigrated) {
    storage.markStickerImagesMigrated();
  }
}
