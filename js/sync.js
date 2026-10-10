// Syncing with a private GitHub repository through GitHub's API.
// Each sync: read what's on GitHub, merge it into this device's data, then
// write back any changed files as one commit. If another device committed
// in between, start again (nothing is ever overwritten blindly).

import { base64ToUtf8, utf8ToBase64, gitBlobSha } from './util.js';

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'auth' | 'notfound' | 'offline' | 'ratelimit' | 'conflict' | 'other'
  }
}

export class GitHubClient {
  constructor({ owner, repo, token, fetchImpl }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.fetch = fetchImpl ?? ((...a) => fetch(...a));
    this.base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  async req(method, path, body) {
    let res;
    try {
      res = await this.fetch(this.base + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError('offline', "Couldn't reach GitHub. You may be offline; changes are kept on this device.");
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    const info = await res.json().catch(() => ({}));
    const msg = info.message ?? '';
    if (res.status === 401) throw new SyncError('auth', 'GitHub rejected the access key. It may have expired or been typed wrongly.');
    if (res.status === 403 && res.headers?.get?.('x-ratelimit-remaining') === '0') {
      throw new SyncError('ratelimit', 'GitHub says too many requests. Sync will work again within an hour.');
    }
    if (res.status === 403) throw new SyncError('auth', `GitHub refused access (${msg}). Check the key has "Contents: Read and write" for this repository.`);
    if (res.status === 404) throw new SyncError('notfound', `Repository ${this.owner}/${this.repo} not found, or the access key can't see it.`);
    const err = new SyncError(res.status === 409 ? 'empty' : res.status === 422 ? 'conflict' : 'other', `GitHub error ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Reads the whole repository. Reuses cached text for files that haven't changed.
// wanted(path): whether to download a file's contents.
export async function pullRemote(client, cache, wanted) {
  const repo = await client.req('GET', '');
  const branch = repo.default_branch;
  let ref;
  try {
    ref = await client.req('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
  } catch (e) {
    if (e.kind === 'empty' || e.kind === 'notfound') return { empty: true, branch };
    throw e;
  }
  const headSha = ref.object.sha;
  const commit = await client.req('GET', `/git/commits/${headSha}`);
  const treeSha = commit.tree.sha;
  const tree = await client.req('GET', `/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) throw new SyncError('other', 'The repository is too large for GitHub to list in one go.');

  const blobs = tree.tree.filter(t => t.type === 'blob' && wanted(t.path));
  const files = new Map();
  await mapLimit(blobs, 6, async b => {
    const hit = cache.get(b.path);
    if (hit && hit.sha === b.sha) {
      files.set(b.path, hit);
    } else {
      const blob = await client.req('GET', `/git/blobs/${b.sha}`);
      files.set(b.path, { sha: b.sha, text: base64ToUtf8(blob.content) });
    }
  });
  return { empty: false, branch, headSha, treeSha, files };
}

// What needs writing (text) or removing (null).
export function diffFiles(desired, remoteFiles, isManaged) {
  const changes = new Map();
  for (const [path, text] of desired) {
    if (remoteFiles.get(path)?.text !== text) changes.set(path, text);
  }
  for (const path of remoteFiles.keys()) {
    if (isManaged(path) && !desired.has(path)) changes.set(path, null);
  }
  return changes;
}

export async function pushChanges(client, remote, changes, message) {
  const tree = await client.req('POST', '/git/trees', {
    base_tree: remote.treeSha,
    tree: [...changes].map(([path, text]) =>
      text === null
        ? { path, mode: '100644', type: 'blob', sha: null }
        : { path, mode: '100644', type: 'blob', content: text }),
  });
  const commit = await client.req('POST', '/git/commits', { message, tree: tree.sha, parents: [remote.headSha] });
  try {
    await client.req('PATCH', `/git/refs/heads/${encodeURIComponent(remote.branch)}`, { sha: commit.sha, force: false });
  } catch (e) {
    if (e.kind === 'conflict') throw new SyncError('conflict', 'Another device synced at the same moment.');
    throw e;
  }
  return commit.sha;
}

// opts:
//   cache:        Map path -> { sha, text } from the last sync (updated in place)
//   wanted(path): which files to download
//   isManaged(path): which files the app may rewrite or delete
//   merge(files): merge Map path -> text from GitHub into local data
//   desired(remoteFiles): Map path -> text of what GitHub should contain
//   initialReadme: text for README.md when the repository is completely empty
export async function runSync(client, opts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await pullRemote(client, opts.cache, opts.wanted);
    if (remote.empty) {
      await client.req('PUT', '/contents/README.md', {
        message: 'Set up Learning Tester data',
        content: utf8ToBase64(opts.initialReadme),
      });
      continue;
    }
    const texts = new Map([...remote.files].map(([p, f]) => [p, f.text]));
    await opts.merge(texts);
    const desired = opts.desired(remote.files);
    const changes = diffFiles(desired, remote.files, opts.isManaged);

    // Remember what's on GitHub now, so next time only changed files are downloaded.
    opts.cache.clear();
    for (const [p, f] of remote.files) opts.cache.set(p, f);
    if (!changes.size) return { pushed: 0, pulled: texts.size };

    try {
      await pushChanges(client, remote, changes, opts.message ?? 'Sync');
    } catch (e) {
      if (e.kind === 'conflict') continue;
      throw e;
    }
    for (const [p, text] of changes) {
      if (text === null) opts.cache.delete(p);
      else opts.cache.set(p, { sha: await gitBlobSha(text), text });
    }
    return { pushed: changes.size, pulled: texts.size };
  }
  throw new SyncError('conflict', 'Sync kept clashing with another device. It will try again shortly.');
}
