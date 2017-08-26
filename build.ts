import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as webpack from 'webpack';
import webpackConfig from './webpack.config';
import * as WebpackMiddleware from 'webpack-dev-middleware';
import * as BrowserSync from 'browser-sync';

const Metalsmith: any = require('metalsmith');
const layouts: any = require('metalsmith-layouts');
const sass: any = require('metalsmith-sass');
const autoprefixer: any = require('metalsmith-autoprefixer');
const assets: any = require('metalsmith-assets');
const inPlace: any = require('metalsmith-in-place');
const inlineSource: any = require('metalsmith-inline-source');
const stripAnsi = require('strip-ansi');

(async () => {
	let publish = false;
	let serve = false;
	let production = process.env.NODE_ENV === 'production';

	process.argv.slice(2).forEach(arg => {
		switch (arg) {
			case 'serve':
				serve = true;
				break;
			case 'publish':
				publish = true;
				production = true;
				break;
			case 'help':
			case '-h':
			case '--help':
				printUsage();
				process.exit(0);
				break;
			default:
				console.error(`Unknown option "${arg}"\n`);
				printUsage();
				process.exit(1);
		}
	});

	if (serve && publish) {
		console.error('Only one of "serve" and "publish" may be specified');
		process.exit(1);
	}

	if (serve) {
		await runServer();
	} else {
		await runMetalsmith({ production, publish });
		await runWebpack();
	}
})();

function runServer() {
	const browserSync = BrowserSync.create();
	const compiler = webpack(webpackConfig);
	const webpackMiddlware = WebpackMiddleware(compiler, {
		publicPath: webpackConfig.output!.publicPath!,
		noInfo: false,
		stats: false
	});

	compiler.plugin('done', (stats: webpack.Stats) => {
		if (stats.hasErrors() || stats.hasWarnings()) {
			return (<any>browserSync).sockets.emit('fullscreen:message', {
				title: 'Webpack error:',
				body: stripAnsi(stats.toString()),
				timeout: 100000
			});
		} else {
			browserSync.reload();
		}
	});

	browserSync.init({
		server: { baseDir: 'public' },
		open: false,
		notify: false,
		logFileChanges: true,
		middleware: [webpackMiddlware],
		plugins: ['bs-fullscreen-message'],
		files: [
			'public/**/*',
			{
				match: ['site/**/*'],
				fn: () => {
					runMetalsmith();
				}
			}
		]
	});

	runMetalsmith();
}

function runWebpack() {
	console.log('Running webpack...');
	return new Promise((resolve, reject) => {
		webpack(webpackConfig, (err: Error, stats: webpack.Stats) => {
			if (err) {
				reject(err);
			} else if (stats.hasErrors()) {
				const info = stats.toJson();
				reject(new Error(info.errors));
			} else {
				resolve();
			}
		});
	});
}

function runMetalsmith(options?: { production?: boolean; publish?: boolean }) {
	console.log('Running Metalsmith...');

	const { production = false, publish = false } = options || {};

	const metalsmith = new Metalsmith(__dirname)
		.metadata({
			site: {
				name: 'The Intern',
				description: 'Software testing for humans'
			},
			pageType: 'default',
			bodyClass: '',
			production: production
		})
		.source('./site')
		.destination('./public')
		.use(docsets())
		.use(inPlace())
		.use(
			layouts({
				engine: 'ejs',
				directory: './site/layouts',
				default: 'default.ejs',
				pattern: '**/*.html'
			})
		)
		.use(
			sass({
				outputStyle: production ? 'compressed' : 'expanded',
				sourceMap: !production,
				sourceMapContents: true,
				outputDir: 'css'
			})
		)
		.use(autoprefixer())
		.use(
			inlineSource({
				rootpath: './site/assets'
			})
		)
		.use(
			assets({
				source: './site/assets'
			})
		);

	if (publish) {
		if (existsSync('public')) {
			console.log('Removing existing public dir');
			execSync('rm -r public');
		}
		console.log('Creating a clone of the master branch');
		execSync('git clone -q . public');
		execSync('git checkout -q master', { cwd: 'public' });
	}

	const build = new Promise((resolve, reject) => {
		metalsmith.build((error?: Error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});

	return build
		.then(() => {
			console.log('Built!');

			if (publish) {
				console.log('Publishing...');
				execSync('git add .', { cwd: 'public' });
				execSync('git commit --all -m "Updated doc build"', {
					cwd: 'public'
				});
				execSync('git fetch public master:master');
			}
		})
		.then(() => {
			if (publish) {
				console.log(
					"Published code is now in master. Don't forget to push!"
				);
			}
		});

	function docsets() {
		return (
			files: { [key: string]: any },
			metalsmith: any,
			done: () => void
		) => {
			if (files['docs.json']) {
				const data = files['docs.json'].contents.toString('utf8');
				metalsmith.metadata().docsets = JSON.parse(data);
				delete files['docs.json'];
			}
			done();
		};
	}
}

function printUsage() {
	console.log('usage: build [serve | publish] [production]');
	console.log('  serve      - start a dev server');
	console.log('  publish    - build and publish the site');
	console.log('  production - build in production mode');
}
