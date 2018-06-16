const sourceMaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const merge = require('merge2');
const gulp = require('gulp');
const del = require('del');

const outDir = 'out';

gulp.task('build', () => {
  const res = gulp.src('src/**/*.ts')
                    .pipe(sourceMaps.init())
                    .pipe(ts.createProject('tsconfig.json')())
                    .on('error', () => {});

  const js = res.js.pipe(sourceMaps.write('.', {
    includeContent: false,
    sourceRoot: ""
  })).pipe(gulp.dest(outDir));
  const dts = res.dts.pipe(gulp.dest(outDir));
  return merge(js, dts);
});

gulp.task('watch', ['build'], () => {
  return gulp.watch('src/**/*.ts', ['build']);
});

gulp.task('clean', () => {
  return del(`${outDir}/**`);
});

gulp.task('default', ['build']);
