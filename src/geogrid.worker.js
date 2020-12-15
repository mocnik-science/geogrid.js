"use strict"

/****** WORKER ******/
module.exports.isea3hWorker = () => {
  importScripts('./vptree.js/vptree.min.js')

  // helping functions
  const _postMessage = x => postMessage(JSON.stringify(x))
  
  const log = (...message) => _postMessage({task: 'log', message: message.join(' ')})
  const error = (...message) => {throw message.join(' ')}
  const progress = percent => _postMessage({task: 'progress', percent: percent})
  const debugStep = (title, percent) => _postMessage({task: 'debugStep', title: title, percent: percent})

  const parseIntFast = str => {
    let r = str.charCodeAt(0) - 48
    const strLength = str.length
    for (let i = 1; i < strLength; i++) r = 10 * r + str.charCodeAt(i) - 48
    return r
  }
  // replaces Math.min(...xs) but also works for very large array
  const _min = xs => {
    let len = xs.length
    let min = Infinity
    while (len--) if (xs[len] < min) min = xs[len]
    return min
  }
  // replaces Math.max(...xs) but also works for very large array
  const _max = xs => {
    let len = xs.length
    let max = -Infinity
    while (len--) if (xs[len] > max) max = xs[len]
    return max
  }
  
  // message handler
  onmessage = e => {
    const d = JSON.parse(e.data)
    switch (d.task) {
      case 'computeCells':
        _postMessage({
          task: 'resultComputeCells',
          cells: computeGeoJSON(d.json, d.bbox),
        })
        break
      case 'findCell':
        _postMessage({
          task: d.taskResult,
          cell: findCell(d.lat, d.lon),
          lat: d.lat,
          lon: d.lon,
        })
        break
      case 'findNeighbors':
        _postMessage({
          task: 'resultFindNeighbors',
          uid: d.uid,
          neighbors: findNeighbors(d.idLong),
        })
        break
    }
  }

  // constants
  const rad = Math.PI / 180
  const radCircle = 2 * Math.PI

  // caches
  let cacheNeighbors = {}
  let cacheVertices = {}
  let resolution = null
  let dataAll = null
  let data = null
  let cells = null
  let tree = null

  // helping function: clean up data about cells
  const cleanupCell = c => {
    const cell = {
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      isPentagon: c.isPentagon,
    }
    if (c.filtered !== false) cell.vertices = c.vertices
    return cell
  }

  // compute GeoJSON
  const computeGeoJSON = (json, bbox) => {
    // handle errors
    if (json === null && dataAll === null) error('data error - no data')
    if (json !== null && json.error) error(`data error - ${json.message}`)

    if (json !== null) {
      // save resolution
      resolution = json.resolution

      // parse cell IDs
      debugStep('parse cell IDs', 10)
      dataAll = []
      for (const d of json.data) {
        if (d.lat !== undefined) dataAll.push(d)
        else {
          const d2 = {id: d}
          d2.isPentagon = d2.id.startsWith('-')
          let idWithoutSign = d2.isPentagon ? d2.id.substr(1) : d2.id
          if (idWithoutSign.length % 2 == 0) idWithoutSign = '0' + idWithoutSign
          const numberOfDecimalPlaces = (idWithoutSign.length - 2 - 5) / 2
          d2.lat = parseIntFast(idWithoutSign.substr(2, numberOfDecimalPlaces + 2)) / Math.pow(10, numberOfDecimalPlaces)
          d2.lon = parseIntFast(idWithoutSign.substr(2 + numberOfDecimalPlaces + 2)) / Math.pow(10, numberOfDecimalPlaces)
          const partB = parseIntFast(idWithoutSign.substr(0, 2))
          if ((partB >= 22 && partB < 44) || partB >= 66) d2.lat *= -1
          if (partB >= 44) d2.lon *= -1
          dataAll.push(d2)
        }
      }
    }

    // make data complete by repetition
    debugStep('make data complete by repetition', 10)
    data = []
    if (bbox === undefined) bbox = {
      west: _min(dataAll.map(d => d.lon)),
      east: _max(dataAll.map(d => d.lon)),
      south: _min(dataAll.map(d => d.lat)),
      north: _max(dataAll.map(d => d.lat)),
    }
    const minLonN = Math.floor((bbox.west + 180) / 360)
    const maxLonN = Math.ceil((bbox.east - 180) / 360)
    const diameterCell = Math.pow(1 / Math.sqrt(3), resolution - 1) * 36 * 2 / 3
    const west = bbox.west - diameterCell
    const east = bbox.east + diameterCell
    const south = bbox.south - diameterCell
    const north = bbox.north + diameterCell
    const repeatNumber = Math.ceil((bbox.east - bbox.west) / 360)
    for (let i = minLonN; i <= maxLonN; i++) for (const d of dataAll) {
      const lonNew = d.lon + i * 360
      if (west <= lonNew && lonNew <= east && south <= d.lat && d.lat <= north) {
        dNew = {
          id: d.id,
          idLong: `${d.id}_${i}`,
          lat: d.lat,
          lon: lonNew,
          sinLat: Math.sin(d.lat * rad),
          cosLat: Math.cos(d.lat * rad),
          lonN: i,
          isPentagon: d.isPentagon,
          vertices: cacheVertices[d.id],
        }
        data.push(dNew)
      }
    }

    // load the data into a tree
    debugStep('load data into tree', 15)
    const Mathmin = (a, b) => (a < b) ? a : b
    tree = VPTreeFactory.build(data, (d0, d1) => Math.acos(Mathmin(d0.sinLat * d1.sinLat + d0.cosLat * d1.cosLat * Math.cos((d1.lon - d0.lon) * rad), 1)))

    // find neighbours for the cells
    debugStep('find neighbours for the cells', 20)
    cells = {}
    for (const d of data) {
      const numberOfNeighborsToLookFor = d.isPentagon ? 5 : 6
      const ns = (d.isPentagon) ? undefined : cacheNeighbors[d.idLong]
      if (ns !== undefined) d.neighbors = ns
      else {
        d.neighbors = []
        for (let x of tree.search(d, 6 * (repeatNumber + 1) + 1).splice(1)) {
          const n = data[x.i]
          if (n.id !== d.id && Math.abs(d.lon - n.lon) < 180) d.neighbors.push(n.idLong)
          if (d.neighbors.length >= numberOfNeighborsToLookFor) break
        }
        cacheNeighbors[d.id] = d.neighbors
      }
      cells[d.idLong] = d
    }

    // filter cells I
    // filter cells by location of neighbours
    debugStep('filter cells I', 40)
    for (const id in cells) {
      const c = cells[id]
      if (c.vertices !== undefined) continue
      let numberOfMatchingNeighbors = 0
      for (const id2 of c.neighbors) if (cells[id2] !== undefined && cells[id2].neighbors.indexOf(id) >= 0) numberOfMatchingNeighbors++
      if (numberOfMatchingNeighbors < (c.isPentagon ? 5 : 6)) c.filtered = false
    }

    // compute angles and vertices
    debugStep('compute angles and vertices', 45)
    for (const id in cells) {
      const c = cells[id]
      if (c.filtered === false || c.vertices !== undefined) continue
      c.angles = []
      // compute angles
      for (let id2 of c.neighbors) {
        let n = cells[id2]
        if (n === undefined) continue
        const ncLon = (n.lon - c.lon) * rad
        c.angles.push({
          angle: Math.atan2(Math.sin(ncLon) * n.cosLat, c.cosLat * n.sinLat - c.sinLat * n.cosLat * Math.cos(ncLon)),
          lat: n.lat,
          lon: n.lon,
        })
      }
      // sort angles
      c.angles.sort((a, b) => (a.angle < b.angle) ? -1 : 1)
      // compute vertices
      c.vertices = []
      for (let i = 0; i <= c.angles.length; i++) {
        const n1 = c.angles[i % c.angles.length]
        const n2 = c.angles[(i + 1) % c.angles.length]
        c.vertices.push([(n1.lon + n2.lon + c.lon) / 3, (n1.lat + n2.lat + c.lat) / 3])
      }
    }

    // filter cells II
    // filter cells by their distortion
    debugStep('filter cells II', 50)
    for (const id in cells) {
      const c = cells[id]
      if (c.filtered === false || c.isPentagon) continue
      else {
        let filter = true
        for (let i = 0; i < 6; i++) {
          const aBefore = Math.abs((c.angles[(i + 2 < 6) ? i + 2 : i - 4].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          const a = Math.abs((c.angles[(i + 3 < 6) ? i + 3 : i - 3].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          const aAfter = Math.abs((c.angles[(i + 4 < 6) ? i + 4 : i - 2].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          if ((aBefore < a) || (aAfter < a)) {
            filter = false
            break
          }
        }
        if (!filter) c.filtered = false
      }
    }

    // cache neighbours
    debugStep('cache neighbours and vertices', 55)
    for (const id in cells) if (cells[id].filtered != false) {
      cacheNeighbors[id] = cells[id].neighbors
      cacheVertices[id] = cells[id].vertices
    }
    
    // clean up data about cells
    debugStep('clean up data about cells', 60)
    const cells2 = new Array(Object.keys(cells).length)
    let i = -1
    for (let id in cells) {
      i++
      cells2[i] = cleanupCell(cells[id])
    }

    // send data to browser
    debugStep('send data to browser', 62.5)
    
    return cells2
  }

  // find cell for given coordinates
  const findCell = (lat, lon) => {
    for (let x of tree.search({
      lat: lat,
      lon: lon,
      sinLat: Math.sin(lat * rad),
      cosLat: Math.cos(lat * rad),
    }, 1)) return data[x.i]
  }

  // find neighbors of a given cell
  const findNeighbors = idLong => cacheNeighbors[idLong] === undefined ? null : cacheNeighbors[idLong].map(idLong2 => cleanupCell(cells[idLong2]))
}
