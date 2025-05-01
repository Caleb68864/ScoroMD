export class SanitizationService {
  /**
   * Sanitizes a name (client, project, task) for display and storage
   * Handles special characters, underscores, and other formatting
   */
  static sanitizeName(name: string): string {
    if (!name) return '';

    return name
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Replace underscore followed by space with just space
      .replace(/_ /g, ' ')
      // Replace space followed by underscore with just space
      .replace(/ _/g, ' ')
      // Replace standalone underscore with space
      .replace(/ _ /g, ' ')
      // Replace remaining underscores with spaces
      .replace(/_/g, ' ')
      // Replace multiple spaces again (in case underscore replacements created any)
      .replace(/\s+/g, ' ')
      // Remove any special characters that shouldn't be in names
      .replace(/[*"<>:|?]/g, '')
      // Replace comma followed by space with just space
      .replace(/,\s+/g, ' ')
      // Replace any remaining commas with nothing
      .replace(/,/g, '')
      // Replace periods that aren't part of file extensions
      .replace(/\.(?!\w+$)/g, '')
      // Remove trailing periods
      .replace(/\.+$/, '')
      // Trim whitespace
      .trim();
  }

  /**
   * Sanitizes a path or path segment for safe file system usage
   * Preserves folder structure if needed
   */
  static sanitizePath(path: string, preserveSlashes: boolean = false): string {
    if (!path) return '';

    // Split path into segments if preserving structure
    const segments = preserveSlashes ? path.split(/[/\\]+/) : [path];

    return segments
      .map(segment => {
        // Handle file extension
        const extensionMatch = segment.match(/(\.[a-zA-Z0-9]+)$/);
        let basename = segment;
        let extension = '';
        
        if (extensionMatch) {
          extension = extensionMatch[0];
          basename = segment.substring(0, segment.length - extension.length);
        }

        // Sanitize the basename
        let sanitized = this.sanitizeName(basename);

        // Ensure we have a valid name
        if (!sanitized) {
          sanitized = 'unnamed';
        }

        // Add back extension if it existed
        if (extension) {
          sanitized += extension;
        }

        return sanitized;
      })
      .join(preserveSlashes ? '/' : ' ');
  }

  /**
   * Sanitizes a folder path, preserving the structure
   */
  static sanitizeFolderPath(path: string): string {
    return this.sanitizePath(path, true);
  }

  /**
   * Sanitizes a file name (single segment)
   */
  static sanitizeFileName(name: string): string {
    return this.sanitizePath(name, false);
  }
} 