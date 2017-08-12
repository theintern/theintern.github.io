module.exports = function(grunt){
	grunt.initConfig({
		'curl-dir': {
			'v4docs': {
				src: ['https://raw.githubusercontent.com/theintern/intern/master/docs/{api,architecture,ci,concepts,configuration,developing,extending,getting_started,help,how_to,running,writing_tests}.md'],
				dest: './source/docs/v4/'
			},
			
		},
		'curl': {
			'v4tutorial': {
				src: 'https://raw.githubusercontent.com/theintern/intern-tutorial/master/README.md',
				dest: './source/docs/v4/intern-tutorial.md'
			},
			'v3tutorial': {
				src: 'https://raw.githubusercontent.com/theintern/intern-tutorial/intern-3/README.md',
				dest: './source/docs/v3/intern-tutorial.md'
			}
		}
	});

	grunt.loadNpmTasks('grunt-curl');
	grunt.registerTask('default', ['curl-dir', 'curl']);
};