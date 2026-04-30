const Fastify = require('fastify');
const cors = require('@fastify/cors');
const path = require('path');
const fastifyStatic = require('@fastify/static');
const fastifyMultipart = require('@fastify/multipart');

// Middleware
const { setupAuth } = require('./middleware/auth');
const { setupRateLimit } = require('./middleware/rateLimit');


// Routes
const customExerciseRoutes = require('./routes/customExercises');
const customFoodRoutes = require('./routes/customFoods');
const foodRoutes = require('./routes/food');
const foodsRoutes = require('./routes/foods');
const profileRoutes = require('./routes/profile');
const workoutRoutes = require('./routes/workouts');
const planRoutes = require('./routes/plans');
const weightRoutes = require('./routes/weight');
const bugReportRoutes = require('./routes/bugReports');
const exerciseRoutes = require('./routes/exercises');
const parseFoodTextRoutes = require('./routes/parseFoodText');
const collectionRoutes = require('./routes/collections');
const waterRoutes = require('./routes/water');
const mlRoutes = require('./routes/ml');
const healthConnectRoutes = require('./routes/healthConnect');
const measurementRoutes = require('./routes/measurements');
const exportRoutes = require('./routes/export');
const recipeRoutes = require('./routes/recipes');
const fastRoutes = require('./routes/fasts');

const fastify = Fastify({ logger: true });

const start = async () => {
  // CORS
  await fastify.register(cors, {
    origin: ['https://macromirco.com', /^http:\/\/localhost(:\d+)?$/],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Static files (exercise images + user uploads)
  await fastify.register(fastifyStatic, {
    root: path.join('/app/static'),
    prefix: '/images/',
    decorateReply: false,
  });

  // Multipart file uploads
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  // Auth
  await setupAuth(fastify);

  // Rate limiting
  await setupRateLimit(fastify);

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register all routes
  await fastify.register(foodRoutes);
  await fastify.register(foodsRoutes);
  await fastify.register(profileRoutes);
  await fastify.register(workoutRoutes);
  await fastify.register(planRoutes);
  await fastify.register(weightRoutes);
  await fastify.register(bugReportRoutes);
  await fastify.register(exerciseRoutes);
  await fastify.register(customFoodRoutes);  // /custom-foods, /public-foods
  await fastify.register(customExerciseRoutes); // /custom-exercises, /public-exercises
  await fastify.register(parseFoodTextRoutes);  // /parse-food-text
  await fastify.register(collectionRoutes);    // /collections, /favorites
  await fastify.register(waterRoutes);         // /water
  await fastify.register(mlRoutes);            // /ml/predict, /ml/health
  await fastify.register(healthConnectRoutes); // /sync/health-connect, /sync/health-connect/status
  await fastify.register(measurementRoutes);   // /measurements
  await fastify.register(exportRoutes);        // /export
  await fastify.register(recipeRoutes);        // /recipes
  await fastify.register(fastRoutes);          // /fasts

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    reply.code(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
