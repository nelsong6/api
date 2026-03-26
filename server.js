// Shared API gateway — consolidates all app backends into a single always-on
// Container App. Each app's routes are installed as npm packages and mounted
// under a path prefix so frontends just update their base URL.
//
// Route mounting:
//   /workout/*  → @nelsong6/kill-me-routes
//   /plant/*    → @nelsong6/plant-agent-routes
//   /homepage/* → @nelsong6/my-homepage-routes
//   /auth/*     → shared Microsoft OAuth
//   /health     → health check

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { createRequireAuth, requireAdmin } from './middleware/auth.js';
import { createMicrosoftRoutes } from './auth/microsoft-routes.js';
import { fetchAppConfig } from './startup/appConfig.js';

// kill-me routes
import {
  createWorkoutRoutes,
  createSorenessRoutes,
  createCardioRoutes,
  createAdminRoutes,
} from '@nelsong6/kill-me-routes';

// my-homepage routes
import { createHomepageRoutes } from '@nelsong6/my-homepage-routes';

// plant-agent routes
import {
  createPlantRoutes,
  createEventRoutes,
  createPhotoRoutes,
  createCaptureRoutes,
  createAnalysisRoutes,
  createTaskRoutes,
  createChatRoutes,
  createPushRoutes,
  createNotifyRoutes,
} from '@nelsong6/plant-agent-routes';

const app = express();
const PORT = process.env.PORT || 3000;
let serverReady = false;

// Middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('combined'));

// Gate requests until async init completes
app.use((req, res, next) => {
  if (serverReady) return next();
  res.status(503).json({ error: 'Server is starting up, please retry shortly.' });
});

async function startServer() {
  const config = await fetchAppConfig();

  // Auth middleware
  const requireAuth = createRequireAuth({ jwtSecret: config.jwtSigningSecret });

  // Cosmos DB — shared client, multiple databases
  const credential = new DefaultAzureCredential();
  const cosmosClient = new CosmosClient({
    endpoint: config.cosmosDbEndpoint,
    aadCredentials: credential,
  });

  // ── kill-me (WorkoutTrackerDB) ──
  const workoutDb = cosmosClient.database('WorkoutTrackerDB');
  const workoutContainer = workoutDb.container('workouts');

  // ── plant-agent (PlantAgentDB) ──
  const plantDb = cosmosClient.database('PlantAgentDB');
  const plantsContainer = plantDb.container('plants');
  const eventsContainer = plantDb.container('events');
  const analysesContainer = plantDb.container('analyses');
  const chatsContainer = plantDb.container('chats');
  const pushSubscriptionsContainer = plantDb.container('push-subscriptions');

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Shared auth — mounted at root AND under each app prefix so frontends
  // can call /auth/microsoft/login relative to their base URL without changes.
  const msAuth = createMicrosoftRoutes({
    jwtSecret: config.jwtSigningSecret,
    microsoftClientId: config.microsoftClientId,
    accountContainer: workoutContainer,
  });
  app.use(msAuth);
  app.use('/workout', msAuth);
  app.use('/plant', msAuth);
  app.use('/homepage', msAuth);

  // ── Mount kill-me routes at /workout ──
  app.use('/workout', createWorkoutRoutes({ container: workoutContainer, requireAuth, requireAdmin }));
  app.use('/workout', createSorenessRoutes({ container: workoutContainer, requireAuth, requireAdmin }));
  app.use('/workout', createCardioRoutes({ container: workoutContainer, requireAuth, requireAdmin }));
  app.use('/workout', createAdminRoutes({
    container: workoutContainer,
    cosmosDbEndpoint: config.cosmosDbEndpoint,
    databaseName: 'WorkoutTrackerDB',
    containerName: 'workouts',
    requireAuth,
    requireAdmin,
  }));

  // ── Mount plant-agent routes at /plant ──
  app.use('/plant', createPlantRoutes({ plantsContainer, requireAuth, anthropicApiKey: config.anthropicApiKey, storageAccountEndpoint: config.storageAccountEndpoint }));
  app.use('/plant', createEventRoutes({ eventsContainer, requireAuth }));
  app.use('/plant', createPhotoRoutes({ requireAuth, storageAccountEndpoint: config.storageAccountEndpoint, plantsContainer }));
  app.use('/plant', createCaptureRoutes({ requireAuth }));
  app.use('/plant', createAnalysisRoutes({ analysesContainer, requireAuth }));
  app.use('/plant', createTaskRoutes({ plantsContainer, eventsContainer, requireAuth }));
  app.use('/plant', createChatRoutes({ plantsContainer, eventsContainer, chatsContainer, requireAuth, anthropicApiKey: config.anthropicApiKey, storageAccountEndpoint: config.storageAccountEndpoint }));
  app.use('/plant', createPushRoutes({ pushSubscriptionsContainer, requireAuth, vapidPublicKey: config.vapidPublicKey }));
  app.use('/plant', createNotifyRoutes({ pushSubscriptionsContainer, plantsContainer, eventsContainer, anthropicApiKey: config.anthropicApiKey, vapidPublicKey: config.vapidPublicKey, vapidPrivateKey: config.vapidPrivateKey, notifyApiKey: config.notifyApiKey }));

  // ── Mount my-homepage routes at /homepage ──
  const homepageDb = cosmosClient.database('HomepageDB');
  const homepageContainer = homepageDb.container('userdata');

  app.use('/homepage', createHomepageRoutes({
    requireAuth,
    container: homepageContainer,
  }));

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  serverReady = true;
  console.log(`Shared API ready on port ${PORT}`);
}

app.listen(PORT, () => {
  startServer().catch((error) => {
    console.error('Fatal startup error:', error);
    process.exit(1);
  });
});

export default app;
