"use strict"

/****** IMPORTS ******/
const Data = require('./geogrid.data.js').Data
const Progress = require('./geogrid.progress.js').Progress
const isea3hWorker = require('./geogrid.worker.js').isea3hWorker

/****** HELPING FUNCTIONS ******/
module.exports.defaultOptions = {
  url: null,
  data: null,
  silent: true,
  debug: false,
  resolution: s => {
    if (s <= 3) return 4
    if (s <= 5) return 6
    if (s <= 6) return 8
    if (s <= 9) return 12
    return 14
  },
  parameters: {
    date: new Date().toLocaleDateString(),
    dateFrom: null,
  },
  cellColorKey: 'value',
  cellColorMin: 0,
  cellColorMax: null,
  cellColorScale: (min, max) => (d3) ? d3.scaleLinear().domain([min, max]).range(['#fff', '#f00']) : null,
  cellColorNoData: '#eee',
  cellColorNoKey: '#f00',
  cellColorOpacity: .5,
  cellSizeKey: null,
  cellSizeMin: 0,
  cellSizeMax: null,
  cellSizeScale: (min, max) => {return value => (value - min) / (max - min)},
  cellSizeNoData: 0,
  cellSizeNoKey: 1,
  cellContourColor: null,
  cellContourWidth: 2,
  colorProgressBar: '#ff5151',
  colorDebug: '#1e90ff',
  colorDebugEmphasized: '#f00',
  dataKeys: null,
  dataMap: null,
  attribution: 'plugin &copy; <a href="http://www.geog.uni-heidelberg.de/gis">Heidelberg University</a> and <a href="http://www.mocnik-science.net">Franz-Benjamin Mocnik</a>',
  bboxViewPad: 1.05,
  bboxDataPad: 1.25,
  renderer: 'webgl',
  urlLibs: '/libs',
}

const createWebWorker = (options) => {
  let url = null
  if (options.urlLibs.startsWith('http')) url = options.urlLibs
  else if (options.urlLibs.startsWith('/')) url = `${document.location.protocol}//${document.location.hostname}${document.location.port ? `:${document.location.port}` : ''}${options.urlLibs}`
  else {
    url = document.location.href.split('/')
    url = `${url.splice(0, url.length - 1).join('/')}/${options.urlLibs}`
  }
  const workerFunctionString = `(${isea3hWorker.toString()})()`.replace('importScripts("./vptree.js/vptree.min.js")', `importScripts('${url}/vptree.js/vptree.min.js')`)
  return new Worker(URL.createObjectURL(new Blob([workerFunctionString])))
}

module.exports.initCore = (options, eventListener, callback, visual) => {
  // init options I
  if (options.debug) options.silent = false

  // init progress
  const _progress = new Progress(options, visual)

  // init options II
  if (visual) {
    if (!options.cellContourColor) options.cellContourColor = (options.debug) ? options.colorDebug : '#fff'
    if (options.bboxViewPad < 1) {
      _progress.error('bboxViewPad must be larger than 1')
      options.bboxViewPad = 1
    }
    if (options.bboxDataPad < 1) {
      _progress.error('bboxDataPad must be larger than 1')
      options.bboxDataPad = 1
    }
    if (options.bboxDataPad < options.bboxViewPad) {
      _progress.error('bboxDataPad must be larger or equal than bboxViewPad')
      options.bboxDataPad = options.bboxViewPad
    }
  }

  // init data
  const _data = new Data(options)

  // create web worker
  const _webWorker = createWebWorker(options)
  _webWorker.addEventListener('message', e => {
    const d = JSON.parse(e.data)
    switch (d.task) {
      case 'log':
        _progress.log(d.message)
        return
      case 'progress':
        _progress.progress(d.percent)
        return
      case 'debugStep':
        _progress.debugStep(d.title, d.percent)
        return
      case 'debugFinished':
        _progress.debugFinished()
        return
      case 'resultComputeCells':
        _data.setCells(d.cells)
        _progress.debugStep('produce GeoJSON', 65)
        _data.produceGeoJSON()
        callback(_data.getGeoJSON())
        return
    }
    eventListener(d)
  })
  const _webWorkerPostMessage = d => {
    _webWorker.postMessage(JSON.stringify(d))
  }

  const _processDataInWebWorker = (bbox=undefined) => {
    // proceed only if data is available
    if (options.data === null) return
    // cache the data
    _progress.debugStep('cache the data', 6)
    const data = _data.cacheData()
    // call web worker
    _progress.debugStep('send data to web worker', 8)
    _webWorkerPostMessage({
      task: 'computeCells',
      json: data,
      url: document.location.href,
      bbox: bbox,
    })
  }

  return {
    options,
    _progress,
    _data,
    _webWorker,
    _processDataInWebWorker,
    _webWorkerPostMessage,
  }
}
