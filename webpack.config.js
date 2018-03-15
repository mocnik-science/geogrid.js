const path = require('path')
const webpack = require('webpack')
const MinifyPlugin = require('babel-minify-webpack-plugin')

module.exports = {
  entry: './src/geogrid.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'geogrid.min.js',
  },
  module: {
    loaders: [{
      test: /\.js$/,
      loader: 'babel-loader',
      query: {
        presets: ['es2015'],
      },
    }, {
      test: /\.scss$/,
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
