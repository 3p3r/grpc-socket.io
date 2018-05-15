const _ = require('lodash');
const debug = require('debug')('grpc-express');
const config = require('rc')('grpc-express', {
  proxyUnaryCalls: true,
  proxyServerStreamCalls: true,
  unaryCallsTimeout: 5000,
  serverStreamCallsTimeout: 10000
});

function toUpperCaseFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function toLowerCaseFirstLetter(string) {
  return string.charAt(0).toLowerCase() + string.slice(1);
}

function routeToPathKeys(route) {
  const functionName = route.split('/').slice(-1)[0];
  return {
    upper: route.replace(functionName, toUpperCaseFirstLetter(functionName)),
    lower: route.replace(functionName, toLowerCaseFirstLetter(functionName)),
    name: toLowerCaseFirstLetter(functionName)
  };
}

class Middleware {
  constructor(grpcClient, opts) {
    opts = opts || {};
    this._opts = Object.assign({}, config, opts);
    debug('gRPC middleware constructed', this._opts);
    this._grpcClient = grpcClient;
    this._unaryCalls = new Map();
    this._serverStreamCalls = new Map();
    if (this._opts.proxyUnaryCalls) {
      [
        ...new Set(
          Object.keys(grpcClient.__proto__)
            .filter(
              route =>
                !grpcClient[route].requestStream &&
            !grpcClient[route].responseStream
            )
            .map(route => grpcClient[route].path)
        )
      ].filter(r => r).forEach(route => {
        const keys = routeToPathKeys(route);
        this._unaryCalls.set(keys.lower, keys.name);
        this._unaryCalls.set(keys.upper, keys.name);
      });
      debug('gRPC unary calls', this._unaryCalls);
    } else {
      debug('gRPC unary calls are not proxied');
    }
    if (this._opts.proxyServerStreamCalls) {
      [
        ...new Set(
          Object.keys(grpcClient.__proto__)
            .filter(
              route =>
                !grpcClient[route].requestStream &&
            grpcClient[route].responseStream
            )
            .map(route => grpcClient[route].path)
        )
      ].filter(r => r).forEach(route => {
        const keys = routeToPathKeys(route);
        this._serverStreamCalls.set(keys.lower, keys.name);
        this._serverStreamCalls.set(keys.upper, keys.name);
      });
      debug('gRPC server stream calls', this._serverStreamCalls);
    } else {
      debug('gRPC server stream calls are not proxied');
    }
  }

  proxy(socket, next) {
    this._unaryCalls.forEach((name, path) => {
      socket.on(path, this.proxyUnaryCall.bind(this, socket, name, path));
    });
    this._serverStreamCalls.forEach((name, path) => {
      socket.on(path, this.proxyServerStreamCall.bind(this, socket, name, path));
    });
    next();
  }

  proxyUnaryCall(socket, name, path, args, ack) {
    if (!this.checkArgs(socket, name, path, args, ack)) return;
    let timedout = false;
    // look at https://github.com/grpc/grpc/issues/9973
    // gRPC's node sdk is potato quality. it does not pass up the error.
    let timer = setTimeout(() => {
      timedout = true;
      ack(new Error('timed out'));
    }, this._opts.unaryCallsTimeout);
    debug('gRPC unary proxy request', path);
    this._grpcClient[this._unaryCalls.get(path)](
      args,
      (err, response) => {
        if (timedout) {
          debug('gRPC call already timedout');
          return;
        }
        debug('gRPC unary end', err, response);
        if (err) ack(new Error(err));
        else ack(response);
        clearTimeout(timer);
      }
    );
  }

  proxyServerStreamCall(socket, name, path, args, ack) {
    if (!this.checkArgs(socket, name, path, args, ack)) return;
    debug('gRPC server stream proxy request', path);
    const stream = this._grpcClient[this._serverStreamCalls.get(path)](args);
    stream.on('data', chunk => {
      debug('gRPC server stream chunk', chunk);
      // ack(chunk); // TODO
    });
    stream.on('end', () => {
      debug('gRPC server stream end');
      // ack(null); // TODO
    });
  }

  checkArgs(socket, name, path, args, ack) {
    let passed = true;
    if (!_.isObject(args)) {
      socket.emit('Error', 'arguments must be an object', path);
      debug('arguments must be an object', path, socket.id);
      passed = false;
    }
    if (!_.isFunction(ack)) {
      socket.emit('Error', 'rpc call must register ack', path);
      debug('rpc call must register ack', path, socket.id);
      passed = false;
    }
    return passed;
  }
}

function factory(grpcClient, opts) {
  const instance = new Middleware(grpcClient, opts);
  return instance.proxy.bind(instance);
}

module.exports = factory;