const {
  grpcClient,
  grpcServer
} = require('./service');
const grpcSocketIO = require('../index');
const express = require('express');
const expressApp = express();
const chai = require('chai');
const httpServer = require('http').Server(expressApp);
const socketServer = require('socket.io')(httpServer);
socketServer.use(grpcSocketIO(grpcClient));
let socket = null;

describe('middleware tests', () => {
  it('should trigger the unary proxy', done => {
    socket.emit(
      '/grpcexpress.GrpcExpressService/unaryCallOne',
      { requestData: 'test' }, response => {
        chai.assert.deepEqual(response, {responseData:'unaryCallOneData'});
        done();
      });
  });

  before(start);
  after(close);
});

async function start(port = 2000) {
  await new Promise((resolve, reject) => {
    try {
      httpServer
        .listen(port, () => {
          socket = require('socket.io-client')(`http://localhost:${port}`);
          socket.on('connect', resolve);
        })
        .on('error', err => {
          close();
          reject('failed to launch the service', err);
        });
    } catch (err) {
      close();
      reject('failed to listen', err);
    }
  });
}

function close() {
  socket && socket.close();
  httpServer.close();
  socketServer.close();
  grpcServer.forceShutdown();
}