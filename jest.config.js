module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js',
  ],
};
