import { McpServer } from '@modelcontextprotocol/server';
import type { EnhancvClient } from './enhancv/client.js';
import { buildIconReference, buildResumeStructureReference } from './enhancv/reference.js';
import { registerExportTools } from './tools/export.js';
import { registerResumeReadTools } from './tools/resumes.js';
import { registerResumeWriteTools } from './tools/write.js';
import type { ToolContext } from './tools/common.js';
import { VERSION } from './version.js';

const INSTRUCTIONS = `Tools for the Enhancv resume API (Business Plus plan).
- List/find resumes first (enhancv_list_resumes, enhancv_find_resumes) to get IDs; read one with enhancv_get_resume.
- Create resumes from structured data (enhancv_create_resume, see resource enhancv://reference/resume-structure) or by uploading a PDF/DOC/DOCX (enhancv_upload_resume).
- Enhancv has no update endpoint: edit = enhancv_get_resume, change the structure, enhancv_create_resume (or enhancv_duplicate_resume), then optionally enhancv_delete_resume.
- Export a resume with enhancv_export_resume_pdf. Deletion is permanent and needs confirm=true; only delete when the user asked for it.
- Resumes contain personal data. Do not repeat contact details beyond what the task needs. The API allows 60 requests per minute per key; avoid bulk loops.`;

/** Build one MCP server instance (stateless HTTP creates one per request, stdio exactly one). */
export function createEnhancvServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: 'enhancv-mcp-server', version: VERSION }, { instructions: INSTRUCTIONS });

  registerResumeReadTools(server, context);
  registerResumeWriteTools(server, context);
  registerExportTools(server, context);

  server.registerResource(
    'resume-structure',
    'enhancv://reference/resume-structure',
    {
      title: 'Enhancv resume structure',
      description: 'Sections, item fields, value ranges, layouts and fonts accepted by enhancv_create_resume.',
      mimeType: 'text/markdown'
    },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: buildResumeStructureReference() }] })
  );

  server.registerResource(
    'icons',
    'enhancv://reference/icons',
    {
      title: 'Enhancv icon identifiers',
      description: 'All valid icon identifiers for section items.',
      mimeType: 'text/markdown'
    },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: buildIconReference() }] })
  );

  return server;
}

export type { EnhancvClient };
