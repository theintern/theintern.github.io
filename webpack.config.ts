import { resolve } from 'path';
import { Configuration } from 'webpack';

const config: Configuration = {
  devtool: 'source-map',
  entry: ['whatwg-fetch', './src/doc_viewer.ts'],
  output: {
    filename: 'scripts/doc_viewer.js',
    path: resolve('./public')
  },
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          silent: true
        }
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    modules: [resolve('./src'), resolve('./node_modules')],
    alias: {
      // A module requesting highlight.js will load just the bare
      // highlighter, and will then register languages of interest
      'highlight.js$': resolve('./node_modules/highlight.js/lib/highlight.js')
    }
  }
};

export default config;
