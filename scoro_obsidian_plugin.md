---
title: ScoroMD - A Scoro Sync Plugin for Obsidian
author: ChatGPT
description: Obsidian plugin to sync clients, projects, tasks, and time entries with Scoro API.
created: 2025-04-30
tags: [obsidian, plugin, scoro, integration, typescript]
---

# ScoroMD - A Scoro Sync Plugin for Obsidian

This Obsidian plugin periodically syncs data from the Scoro API (clients, projects, tasks, time entries) into a vault folder structure, and vice versa. It uses modern TypeScript and the Obsidian Plugin API to create notes and folders (`Vault.createFolder`, `Vault.create`, etc.). The user configures the Scoro *base URL*, *API key*, and sync interval in a settings panel. A “Sync All” command (ribbon icon or command palette) triggers fetching all data and updating the vault.

## Plugin Settings

The settings include:

- **Scoro API Base URL**
- **Company Account ID**
- **API Key**
- **Sync interval** (manual, hourly, daily)

```ts
interface ScoroSettings {
  apiBase: string;
  apiKey: string;
  companyId: string;
  syncIntervalHours: number;
}
const DEFAULT_SETTINGS: ScoroSettings = {
  apiBase: '',
  apiKey: '',
  companyId: '',
  syncIntervalHours: 24,
};
```

## Scoro API Integration

Use Scoro’s JSON REST API:

```ts
async function scoroPost(path: string, body: any): Promise<any> {
  const url = \`\${this.settings.apiBase}/\${path}\`;
  const payload = {
    lang: 'eng',
    company_account_id: this.settings.companyId,
    apiKey: this.settings.apiKey,
    ...body
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}
```

## Folder Structure & Note Generation

Vault structure:

```
Clients/
└── ClientName/
    ├── Client.md
    └── Projects/
        └── ProjectName/
            ├── Project.md
            └── Tasks/
                └── TaskName.md
```

Each note has YAML frontmatter with `last_synced` and key metadata.

## Time Entry Handling

Time entries are read from:

- **Inline in Daily Notes**, using:

```markdown
## 08:30 - 08:45 (0:15) | [[Logic Operations]]  %% fold %%
- **Client**: [[Logic]]
- **People**:
  - [[Caleb Bennett]]
### Details
- Updating Time Entries
```

- **Dedicated notes**, linked from daily notes.

The plugin syncs entries using `timeEntries/modify`, and marks them with `time_entry_id` in frontmatter.

## Sync Commands and Scheduling

Includes:

- **Sync All** button
- **Manual and scheduled syncs**
- **Note watchers** for bidirectional updates

```ts
this.addRibbonIcon('refresh-cw', 'Sync All Scoro Data', () => this.syncAll());
this.addCommand({
  id: 'scoro-sync-all',
  name: 'Sync All Scoro Data',
  callback: () => this.syncAll()
});
```

## Example Plugin Skeleton

```ts
export default class ScoroSyncPlugin extends Plugin {
  async syncAll() {
    await this.syncClients();
    await this.syncProjects();
    await this.syncTasks();
    await this.syncTimeEntries();
  }
}
```

Includes helpers for:

- `syncClients()`
- `syncProjects()`
- `syncTasks()`
- `syncTimeEntries()`

Each uses `Vault.createFolder`, `Vault.create`, or `Vault.modify`.

## Dataview Integration

All notes include consistent frontmatter for Dataview:

```dataview
table project, status, due
from "Clients/Logic/Projects"
where status != "completed"
```

## Future Enhancements

- Filtering by user
- Sidebar sync panel
- Conflict detection
- Dataview query templates
- Quick sync button in daily notes
