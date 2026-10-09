const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('node:path');

module.exports = {
  output: {
    clean: true,
    path: join(__dirname, '../../dist/apps/mcp'),
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      compiler: 'tsc',
      generatePackageJson: true,
      main: './src/main.ts',
      optimization: false,
      outputHashing: 'none',
      runtimeDependencies: ['@prisma/client', 'tslib'],
      sourceMap: true,
      target: 'node',
      tsConfig: './tsconfig.app.json',
    }),
  ],
};
