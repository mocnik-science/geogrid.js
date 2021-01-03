"use strict"

/****** IMPORTS ******/
import {Data} from './geogrid.data.js'
import {Download} from './geogrid.download.js'
import {Progress} from './geogrid.progress.js'
import Worker from './geogrid.worker.js'

/****** HELPING FUNCTIONS ******/
export const defaultOptionsSource = {
  url: null,
  data: null,
  parameters: {
    date: new Date().toLocaleDateString(),
    dateFrom: null,
  },
  tileZoom: 7,
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
  dataKeys: null,
  dataMap: null,
}

export const defaultOptions = {
  ...defaultOptionsSource,
  sources: null,
  silent: true,
  debug: false,
  cellContourColor: null,
  cellContourWidth: 2,
  colorProgressBar: '#ff5151',
  colorDebug: '#1e90ff',
  colorDebugEmphasized: '#f00',
  resolution: s => {
    if (s <= 3) return 4
    if (s <= 5) return 6
    if (s <= 6) return 8
    if (s <= 9) return 12
    return 14
  },
  attribution: 'plugin &copy; <a href="http://www.mocnik-science.net">Franz-Benjamin Mocnik</a>',
  bboxViewPad: 1.05,
  bboxDataPad: 1.25,
  renderer: 'webgl',
  pureBBox: null,
  pureResolution: 7,
}

export const initOptions = options => {
  options.multipleSources = !options.url && !options.data
  if (options.multipleSources) {
    if (options.sources === undefined || options.sources === null) options.sources = []
    else {
      options.sources = options.sources.map(source => ({
        ...defaultOptionsSource,
        ...source,
      }))
    }
  } else options.sources = [options]
}

export const initCore = (options, eventListener, callback, visual) => {
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

  if (visual) {
    // proceed with the initialization
    return initCore2(options, eventListener, callback, _progress)
  } else if (!options.url) {
    // proceed with the initialization
    const {_processDataInWebWorker} = initCore2(options, eventListener, callback, _progress)
    // process
    _processDataInWebWorker()
  } else if (options.pureBBox) new Download(options, options, 0, options.pureResolution, _progress).load(options.pureBBox, data => {
    // save the data
    options.data = data
    options.url = null
    // proceed with the initialization
    const {_processDataInWebWorker} = initCore2(options, eventListener, callback, _progress)
    // process
    _processDataInWebWorker()
  })
}

export const initCore2 = (options, eventListener, callback, _progress) => {
  // init data
  const _data = new Data(options)

  // create web worker
  const _webWorker = new Worker()
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
    // cache the data
    _progress.debugStep('cache the data', 6)
    const dataCells = _data.cacheData(_progress)
    // proceed only if data is available
    if (dataCells === null) {
      _progress.debugFinished()
      return
    }
    // call web worker
    _progress.debugStep('send data to web worker', 8)
    _webWorkerPostMessage({
      task: 'computeCells',
      json: dataCells,
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
