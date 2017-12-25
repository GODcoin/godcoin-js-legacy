const sourceMaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const gulp = require('gulp');
const path = require('path');
const del = require('del');

const outDir = 'out';

gulp.task('build', () => {
  const res = gulp.src('src/**/*.ts')
                    .pipe(sourceMaps.init())
                    .pipe(ts.createProject('tsconfig.json')());

  return res.js.pipe(sourceMaps.write('.', {
    includeContent: false,
    sourceRoot: ""
  })).pipe(gulp.dest(outDir));
});

gulp.task('watch', ['build'], () => {
  return gulp.watch('src/**/*.ts', ['build']);
});

gulp.task('clean', () => {
  return del(`${outDir}/**`);
});
