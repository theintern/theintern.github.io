import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
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
const inlineSource: any = require('inline-source');
const stripAnsi = require('strip-ansi');

(async () => {
	let publish = false;
	let serve = false;
	let remote = 'origin';
	let production = process.env.NODE_ENV === 'production';

	process.argv.slice(2).forEach(arg => {
		if (arg === 'serve') {
			serve = true;
		} else if (/^publish=?/.test(arg)) {
			publish = true;
			production = true;
		} else if (/^remote=/.test(arg)) {
			remote = arg.split('=')[1];
		} else if (/\bhelp$/.test(arg) || arg === '-h') {
			printUsage();
			process.exit(0);
		} else {
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
		if (publish) {
			if (existsSync('public')) {
				console.log('Removing existing public dir');
				execSync('rm -r public');
			}

			console.log('Creating a clone of the master branch');
			execSync('git clone -q . public');
			execSync('git checkout -q master', { cwd: 'public' });
		}

		await runMetalsmith({ production });
		await runWebpack();

		if (publish) {
			console.log('Publishing...');
			const { status } = spawnSync('git', ['diff', '--quiet', 'HEAD'], {
				cwd: 'public'
			});
			if (status !== 0) {
				execSync('git add .', { cwd: 'public' });
				execSync('git commit --all -m "Updated doc build"', {
					cwd: 'public'
				});
				execSync('git fetch public master:master');
				if (remote) {
					execSync(`git push ${remote} master`);
					console.log('Published!');
				} else {
					console.log('Master was updated, but nothing was pushed.');
				}
			} else {
				console.log('Nothing to publish (no changes)');
			}
		}
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
					// Don't clean when rebuilding while serving
					runMetalsmith({ clean: false });
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
			console.log('Webpack finished');
		});
	});
}

function runMetalsmith(options?: { production?: boolean; clean?: boolean }) {
	console.log('Running Metalsmith...');

	const { production = false, clean = true } = options || {};

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
		.ignore('layouts')
		.clean(clean)
		.use(docSets())
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
			inlineSources({
				rootpath: './assets'
			})
		)
		.use(
			assets({
				source: './assets',
				destination: '.'
			})
		)
		.use(copyCheck());

	const build = new Promise((resolve, reject) => {
		metalsmith.build((error?: Error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});

	return build.then(() => {
		console.log('Metalsmith finished');
	});

	function docSets() {
		return (
			files: { [key: string]: any },
			metalsmith: any,
			done: () => void
		) => {
			if (files['docs.json']) {
				const data = files['docs.json'].contents.toString('utf8');
				const docSets = JSON.parse(data);
				metalsmith.metadata().docSets = docSets;
				metalsmith.metadata().guideLink = `/docs.html#Intern/${docSets[
					'Intern'
				].latest}`;
				delete files['docs.json'];
			}
			done();
		};
	}

	// Remove any files from the files list that have equivalent contents to
	// existing files.
	function copyCheck() {
		return (
			files: { [key: string]: any },
			metalsmith: any,
			done: () => void
		) => {
			const dest = metalsmith.destination();
			const names = Object.keys(files);
			for (let name of names) {
				const file = join(dest, name);
				if (existsSync(file)) {
					const contents = readFileSync(file);
					if (files[name].contents.equals(contents)) {
						delete files[name];
					}
				}
			}
			done();
		};
	}

	function inlineSources(options: any) {
		return (
			files: { [key: string]: any },
			_metalsmith: any,
			done: () => void
		) => {
			const htmlFileNames = Object.keys(files).filter(path =>
				/\.html$/.test(path)
			);
			htmlFileNames.forEach(path => {
				const file = files[path];
				file.contents = Buffer.from(
					inlineSource.sync(file.contents.toString(), options)
				);
			});
			done();
		};
	}
}

function printUsage() {
	console.log('usage: build [serve | publish [remote=xyz]]');
	console.log('  serve   - start a dev server');
	console.log('  publish - build and publish the site');
	console.log('  remote  - git remote to push to when publishing');
}
