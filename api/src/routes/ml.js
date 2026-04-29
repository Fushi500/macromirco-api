const http = require('http');
const https = require('https');
const { URL } = require('url');

const ML_SERVER_URL = process.env.ML_SERVER_URL || 'http://localhost:8001';
const ML_TIMEOUT_MS = parseInt(process.env.ML_TIMEOUT_MS || '30000', 10);

/**
 * Create multipart form data boundary and encode file
 */
function encodeMultipart(fileBuffer, filename, mimeType) {
  const boundary = '----FormBoundary' + Date.now();
  const CRLF = '\r\n';

  let body = '';
  body += `--${boundary}${CRLF}`;
  body += `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`;
  body += `Content-Type: ${mimeType || 'application/octet-stream'}${CRLF}${CRLF}`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(body),
    fileBuffer,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ]);

  return {
    body: bodyBuffer,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * POST /ml/predict
 * Proxy food image recognition to ML inference server
 */
async function routes(fastify) {
  fastify.post('/ml/predict', async (request, reply) => {
    try {
      // Verify JWT
      await request.jwtVerify();
      const userId = request.user.sub;

      // Get the file from multipart
      const parts = request.parts();
      let fileBuffer = null;
      let filename = 'image.jpg';
      let mimeType = 'image/jpeg';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          const chunks = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          filename = part.filename || 'image.jpg';
          mimeType = (part.mimetype && part.mimetype.startsWith('image/')) ? part.mimetype : 'image/jpeg';
          break;
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      // Check file size (max 10MB)
      if (fileBuffer.length > 10 * 1024 * 1024) {
        return reply.code(413).send({ error: 'File too large (max 10MB)' });
      }

      // Encode multipart form data
      const { body: multipartBody, contentType } = encodeMultipart(fileBuffer, filename, mimeType);

      // Forward to ML server
      const mlUrl = new URL('/predict', ML_SERVER_URL);
      const protocol = mlUrl.protocol === 'https:' ? https : http;

      const mlRequest = new Promise((resolve, reject) => {
        const options = {
          hostname: mlUrl.hostname,
          port: mlUrl.port,
          path: mlUrl.pathname + mlUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'Content-Length': multipartBody.length,
          },
          timeout: ML_TIMEOUT_MS,
        };

        const req = protocol.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: data,
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('ML server timeout'));
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.write(multipartBody);
        req.end();
      });

      let mlResponse;
      try {
        mlResponse = await mlRequest;
      } catch (err) {
        fastify.log.error(`ML server error: ${err.message}`);
        return reply.code(503).send({ error: 'recognition_unavailable' });
      }

      if (mlResponse.statusCode !== 200) {
        fastify.log.warn(`ML server returned ${mlResponse.statusCode} for user ${userId}`);
        return reply.code(503).send({ error: 'recognition_unavailable' });
      }

      let mlData;
      try {
        mlData = JSON.parse(mlResponse.body);
      } catch (err) {
        fastify.log.error(`Failed to parse ML response: ${err.message}`);
        return reply.code(503).send({ error: 'recognition_unavailable' });
      }

      // Ensure predictions array exists
      if (!mlData.predictions || !Array.isArray(mlData.predictions)) {
        fastify.log.error('Invalid ML response: missing predictions array');
        return reply.code(503).send({ error: 'recognition_unavailable' });
      }

      // Transform response: remove elapsed_ms, add uncertain flag
      const response = {
        predictions: mlData.predictions,
        uncertain: mlData.status === 'uncertain',
      };

      return reply.code(200).send(response);
    } catch (err) {
      if (err.statusCode === 401) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      fastify.log.error(`/ml/predict error: ${err.message}`, err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Health check for ML server (internal, no auth)
  fastify.get('/ml/health', async (request, reply) => {
    const mlUrl = new URL('/health', ML_SERVER_URL);
    const protocol = mlUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: mlUrl.hostname,
      port: mlUrl.port,
      path: mlUrl.pathname + mlUrl.search,
      method: 'GET',
      timeout: 5000,
    };

    try {
      const result = await new Promise((resolve, reject) => {
        const req = protocol.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: data,
            });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.end();
      });

      if (result.statusCode === 200) {
        const data = JSON.parse(result.body);
        return reply.code(200).send(data);
      }
      return reply.code(503).send({ status: 'unavailable' });
    } catch (err) {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}

module.exports = routes;
