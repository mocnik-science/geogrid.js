const path = require('path')
const MinifyPlugin = require('babel-minify-webpack-plugin')

module.exports = {
  entry: './src/geogrid.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'geogrid.min.js',
  },
  module: {
    rules: [{
      test: /\.js$/,
      exclude: [/node_modules/, /src\/geogrid.worker.js/],
      use: {
        loader: 'babel-loader',
        options: {
          presets: ['@babel/preset-env'],
        },
      },
    }, {
      test: /\.scss$/,
      exclude: /node_modules/,
      use: [{
        loader: 'style-loader',
      }, {
        loader: 'css-loader',
        options: {sourceMap: true},
      }, {
        loader: 'sass-loader',
        options: {sourceMap: true},
      }],
    }],
  },
  stats: {
    colors: true,
  },
  devtool: 'source-map',
  plugins: [
    new MinifyPlugin({}),
  ],
}
