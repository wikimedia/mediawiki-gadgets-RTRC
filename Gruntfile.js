/*jshint node:true */
module.exports = function (grunt) {
	grunt.loadNpmTasks('grunt-compare-size');
	grunt.loadNpmTasks('grunt-contrib-concat');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-contrib-watch');

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		concat: {
			src: {
				src: 'src/*',
				dest: 'tmp/rtrc.concat'
			}
		},
		compare_size: {
			files: ['src/*', 'tmp/rtrc.concat'],
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
			options: {
				jshintrc: '.jshintrc'
			},
			all: ['*.js', 'src/*.js']
		},
		watch: {
			files: ['<%= jshint.all %>', '.{jshintrc,jshintignore}'],
			tasks: ['test']
		}
	});

	grunt.registerTask('test', ['jshint']);
	grunt.registerTask('compare', ['concat', 'compare_size']);
	grunt.registerTask('default', ['test', 'compare']);
};
