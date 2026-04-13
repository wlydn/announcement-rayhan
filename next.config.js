/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.8.0.11'],
  api: {
    bodyParser: {
      sizeLimit: '50mb', // Increase from default 4mb to 50mb
    },
  },
};

module.exports = nextConfig;
