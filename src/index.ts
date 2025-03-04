#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { LinearAuth } from './auth.js';
import { LinearGraphQLClient } from './graphql/client.js';
import { HandlerFactory } from './core/handlers/handler.factory.js';
import { toolSchemas } from './core/types/tool.types.js';

/**
 * Main server class that handles MCP protocol interactions.
 * Delegates tool operations to domain-specific handlers.
 * 
 * Authentication options:
 * 1. Environment variable: LINEAR_ACCESS_TOKEN (set before starting the server)
 * 2. MCP tool: linear_auth_api_key (call during runtime with an API key)
 * 3. MCP tool: linear_auth (OAuth flow with browser authorization)
 */
class LinearServer {
  private server: Server;
  private auth: LinearAuth;
  private graphqlClient?: LinearGraphQLClient;
  private handlerFactory: HandlerFactory;

  constructor() {
    this.server = new Server(
      {
        name: 'linear-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.auth = new LinearAuth();
    
    // Initialize with PAT if available in environment
    const accessToken = process.env.LINEAR_ACCESS_TOKEN;
    if (accessToken) {
      this.auth.initialize({
        type: 'pat',
        accessToken
      });
      this.graphqlClient = new LinearGraphQLClient(this.auth.getClient());
    }
    
    // Initialize handler factory
    this.handlerFactory = new HandlerFactory(this.auth, this.graphqlClient);
    
    this.setupRequestHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupRequestHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.values(toolSchemas),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { handler, method } = this.handlerFactory.getHandlerForTool(request.params.name);
        // Use type assertion to handle dynamic method access
        return await (handler as any)[method](request.params.arguments);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('No handler found')) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Linear MCP server running on stdio');
  }
}

const server = new LinearServer();
server.run().catch(console.error);
