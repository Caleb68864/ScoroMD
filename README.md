# ScoroMD - A Scoro Sync Plugin for Obsidian

This plugin synchronizes data between your Scoro account and Obsidian vault, enabling you to:

- View and manage clients, projects, and tasks directly within your Obsidian vault
- Track time entries in your daily notes with automatic syncing to Scoro
- Access Scoro data offline within your knowledge base
- Create structured content with proper linking between entities

## Installation

### Manual Installation
1. Download the latest release from the [releases page](https://github.com/CalebBennett/ScoroMD/releases)
2. Extract the zip file
3. Copy the extracted folder to your Obsidian vault's plugins folder:
   - Open your Obsidian vault
   - Go to Settings → Community plugins → Browse (folder icon)
   - This opens your vault's plugins folder
   - Paste the extracted folder here
4. Restart Obsidian
5. Enable the plugin in Obsidian's Community Plugins settings

## Configuration

1. Open Obsidian Settings
2. Go to "Community Plugins" and find "ScoroMD"
3. Configure the following required settings:
   - **API Base URL**: Your Scoro API base URL (e.g., `https://companyname.scoro.com`)
   - **API Key**: Your Scoro API key (obtained from Scoro admin)
   - **Company Account ID**: Your Scoro company account ID
   - **User ID**: Your Scoro user ID for time entries
   - **Sync Interval**: How often to sync (in hours, 0 for manual only)

### Obtaining Scoro API Credentials

1. **API Base URL**: This is your company's Scoro URL
2. **API Key**:
   - Log in to Scoro as an administrator
   - Go to Administration → Integrations → API
   - Generate a new API key with appropriate permissions
3. **Company Account ID**: 
   - This is usually the subdomain of your Scoro URL
   - For example, if your URL is `https://companyname.scoro.com`, your Company Account ID is `companyname`
4. **User ID**:
   - This is your personal user ID in Scoro
   - Can be found in your Scoro profile settings or from your administrator

## Folder Structure

The plugin creates and maintains the following folder structure in your vault:

```
Clients/
└── [ClientName]/
    ├── Client.md              # Client details
    ├── Contacts/              # Client contacts
    │   └── [ContactName].md   # Individual contact details
    └── Projects/
        └── [ProjectName]/
            ├── Project.md     # Project details
            └── Tasks/
                └── [TaskName].md  # Individual task details

Daily/
└── [YYYY]/                    # Year folders
    └── [MM]/                  # Month folders
        └── [DD].md            # Daily notes with time entries
```

## Using the Plugin

### Manual Sync

To manually sync data from Scoro:

1. Click the sync icon (refresh icon) in the ribbon (left sidebar)
2. Alternatively, use the command palette (Ctrl/Cmd+P) and search for "Sync All Scoro Data"

During syncing:
- The plugin will fetch clients, projects, tasks, and time entries from Scoro
- It will create or update notes in your vault based on the data
- If a note exists with the same name but is missing Scoro identifiers, you'll be prompted to choose how to handle it

### Time Tracking

#### Adding Time Entries Manually

Time entries in daily notes follow this format:

```markdown
## 08:30 - 08:45 | [[Project Name]] - [[Task Name]] %% fold %%
- **Client**: [[Client Name]]
- **People**:
  - [[Person Name]]
### Details
- Work description here
```

The plugin will:
1. Detect time entries in your daily notes
2. Sync them to Scoro
3. Add the Scoro task ID and time entry ID back to your note

#### Using the Time Entry Form

To add a time entry using the built-in form:

1. Click the clock icon in the ribbon (left sidebar)
2. Alternatively, use the command palette (Ctrl/Cmd+P) and search for "Add Time Entry"
3. Fill in the form:
   - Start Time: When the work began
   - End Time: When the work ended (or leave as 00:00 to fill in later)
   - Client: Select from the dropdown
   - Project: Select a project for the selected client
   - Task: (Optional) Select a task for the project
   - People: Add people involved in the work
4. Click "Save" to add the time entry to today's daily note

### Two-Way Sync

The plugin performs two-way synchronization:

1. **Scoro → Obsidian**:
   - Clients, projects, and tasks are synced from Scoro to Obsidian
   - Time entries from Scoro are added to the appropriate daily notes

2. **Obsidian → Scoro**:
   - Time entries created in daily notes are synced to Scoro
   - If you modify a time entry in a daily note, the changes are synced to Scoro

### Handling Conflicts

When syncing notes, if the plugin detects a note with the same name but missing Scoro IDs:

1. A modal dialog will appear asking you to choose:
   - **Replace Note**: Overwrite the existing note with Scoro data
   - **Update Front Matter**: Keep the existing note content but add Scoro IDs
   - **Create "[Name] - Scoro"**: Create a new note with a different name
   - **Cancel**: Skip syncing this note

For time entries with the same task name but missing IDs:

1. A modal dialog will appear asking you to choose:
   - **Replace Entry**: Update the existing entry with Scoro data
   - **Add New Entry**: Keep both entries
   - **Skip Entry**: Don't add the Scoro entry
   - **Cancel**: Cancel the sync operation for this entry

## Dataview Integration

All notes include Dataview-compatible frontmatter for powerful querying. Example queries:

### List Active Projects
```dataview
TABLE status as "Status", deadline as "Due Date", manager_id as "Manager"
FROM "Clients/*/Projects"
WHERE status != "completed"
SORT deadline ASC
```

### Show Today's Time Entries
```dataview
TABLE time_spent as "Time", client as "Client", project as "Project"
FROM "Daily/YYYY/MM/DD"  # Replace with current date
SORT time_spent DESC
```

### Client Project Overview
```dataview
TABLE file.ctime as "Created", status as "Status", deadline as "Due Date"
FROM "Clients/ClientName/Projects"
SORT deadline ASC
```

## Troubleshooting

### Common Issues

1. **API Connection Failures**:
   - Verify your API credentials are correct
   - Check your internet connection
   - Ensure your API key has proper permissions

2. **CORS Issues**:
   - The plugin uses Obsidian's built-in request handling to avoid CORS issues
   - If you see CORS errors in the console logs, try the "Test Scoro API Connection" command
   - Make sure your Scoro API URL is correct and doesn't have double slashes
   - If problems persist, contact your Scoro administrator to verify API access settings

3. **Missing Data**:
   - Confirm you've performed a sync after setting up the plugin
   - Check that the entities exist in Scoro

4. **Time Entry Sync Issues**:
   - Make sure the time entry format in daily notes is correct
   - Verify the referenced projects and tasks exist

5. **Plugin Not Loading**:
   - Check that the plugin is enabled in Obsidian settings
   - Restart Obsidian after making setting changes

### Logs and Support

If you encounter issues:
1. Check the console logs (Ctrl+Shift+I or Cmd+Option+I)
2. Report issues on the [GitHub repository](https://github.com/CalebBennett/ScoroMD/issues)

## Development

1. Clone this repository
2. Install dependencies: `npm install`
3. Build the plugin: `npm run dev`
4. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugins folder

### Creating a Release

#### Automatic Release (GitHub)
1. Update the version in `package.json`, `manifest.json`, and `versions.json`
2. Create and push a new tag matching the version:
   ```
   git tag -a 1.0.0 -m "Release v1.0.0"
   git push origin 1.0.0
   ```
3. GitHub Actions will automatically build and create a release

#### Manual Release
1. Update the version in `package.json`, `manifest.json`, and `versions.json`
2. Run the release script: `release.bat` (Windows) 
3. The release ZIP file will be created in the `releases` folder

## License

MIT License. See [LICENSE](LICENSE) for details. 