/*jshint node:true */
module.exports = function (grunt) {
	grunt.loadNpmTasks('grunt-compare-size');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-contrib-watch');

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		compare_size: {
			files: [
				'src/*.{js,css}'
			],
			options: {
				// Location of stored size data
				cache: '.sizecache.json',

				// Compressor label-function pairs
				compress: {
					gz: function (fileContents) {
						return require('gzip-js').zip(fileContents, {}).length;
					}
				}
			}
		},
		jshint: {
			all: ['*.js', 'src/*.js']
		},
		watch: {
			files: ['<%= jshint.all %>', '.{jshintrc,jshintignore}'],
			tasks: ['test']
		}
	});

	grunt.registerTask('test', ['jshint']);
	grunt.registerTask('default', ['test']);
};
