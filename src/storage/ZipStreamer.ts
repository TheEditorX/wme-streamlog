import * as fflate from 'fflate';
import { IndexedDBManager } from './IndexedDBManager.js';

export class ZipStreamer {
  private dbManager: IndexedDBManager;

  constructor(dbManager: IndexedDBManager) {
    this.dbManager = dbManager;
  }

  /**
   * Exports all sessions and their logs from IndexedDB into a Zip compressed Blob.
   */
  async exportAllSessions(): Promise<Blob> {
    // Flush any pending logs to IndexedDB first
    await this.dbManager.flush();

    const sessions = await this.dbManager.getAllSessions();
    const chunks: BlobPart[] = [];

    return new Promise<Blob>((resolve, reject) => {
      const zip = new fflate.Zip();

      zip.ondata = (err, data, final) => {
        if (err) {
          reject(err);
          return;
        }
        chunks.push(data);
        if (final) {
          resolve(new Blob(chunks, { type: 'application/zip' }));
        }
      };

      const run = async () => {
        const encoder = new TextEncoder();

        for (const session of sessions) {
          const folderName = session.id.startsWith('session_')
            ? session.id
            : `session_${session.id}`;

          // 1. Add session details file
          const detailsFile = new fflate.ZipDeflate(`${folderName}/details.json`);
          zip.add(detailsFile);

          const detailsJson = JSON.stringify(session);
          detailsFile.push(encoder.encode(detailsJson), true);

          // 2. Add session logs file (streamed)
          const logsFile = new fflate.ZipDeflate(`${folderName}/logs.json`);
          zip.add(logsFile);

          // Write starting bracket
          logsFile.push(encoder.encode('['));

          let first = true;

          // Stream logs directly from IndexedDB cursor
          await this.dbManager.streamLogsForSession(session.id, (log) => {
            const logContent = (first ? '' : ',') + JSON.stringify(log);
            first = false;
            logsFile.push(encoder.encode(logContent));
          });

          // Write closing bracket and finalize this file
          logsFile.push(encoder.encode(']'), true);
        }

        // Finalize the zip archive
        zip.end();
      };

      run().catch(reject);
    });
  }
}
