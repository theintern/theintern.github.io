import { join } from 'path';
import { Configuration, optimize } from 'webpack';

declare const __dirname: string;

const config: Configuration = {
	devtool: 'source-map',
	entry: ['whatwg-fetch', './src/doc_viewer.ts'],
	output: {
		filename: 'doc_viewer.js',
		path: join(__dirname, 'public')
	},
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
	externals: {
		'markdown-it': 'markdownit',
		'mark.js': 'Mark',
		'highlight.js': 'hljs'
	},
	resolve: {
		extensions: ['.ts', '.js', '.json']
	}
};

if (process.env.NODE_ENV === 'production') {
	config.plugins = [new optimize.UglifyJsPlugin()];
}

export default config;
