SubsManager = function (options) {
  var self = this;
  self.options = options || {};
  // maxiumum number of subscriptions are cached
  self.options.cacheLimit = self.options.cacheLimit || 10;
  // maximum time, subscription stay in the cache
  self.options.expireIn = self.options.expireIn || 5;

  self._cacheMap = {};
  self._cacheList = [];
  self.ready = false;
  self.dep = new Deps.Dependency();

  self.computation = self._registerComputation();
};

SubsManager.prototype.subscribe = function() {
  var self = this;
  if(Meteor.isClient) {
    this._addSub(arguments);

    return {
      ready: function() {
        self.dep.depend();
        return self.ready;
      }
    };
  } else {
    // to support fast-render
    if(Meteor.subscribe) {
      return Meteor.subscribe.apply(Meteor, arguments);
    }
  }
};

SubsManager.prototype._addSub = function(args) {
  var self = this;
  var hash = EJSON.stringify(args);
  if(!self._cacheMap[hash]) {
    var sub = {
      args: args,
      hash: hash
    };

    self._cacheMap[hash] = sub;
    self._cacheList.push(sub);

    self.ready = false;
    // no need to interfere with the current computation
    if(Deps.currentComputation) {
      Deps.afterFlush(function() {
        self.computation.invalidate();
      });
    } else {
      self.computation.invalidate();
    }
  }

  // add the current sub to the top of the list
  var sub = self._cacheMap[hash];
  sub.updated = (new Date).getTime();

  var index = self._cacheList.indexOf(sub);
  self._cacheList.splice(index, 1);
  self._cacheList.push(sub);
};

SubsManager.prototype._applyCacheLimit = function () {
  var self = this;
  var overflow = self._cacheList.length - self.options.cacheLimit;
  if(overflow > 0) {
    var removedSubs = self._cacheList.splice(0, overflow);
    _.each(removedSubs, function(sub) {
      delete self._cacheMap[sub.hash];
    });
  }
};

SubsManager.prototype._applyExpirations = function() {
  var self = this;
  var newCacheList = [];

  var expirationTime = (new Date).getTime() - self.options.expireIn * 60 * 1000;
  _.each(self._cacheList, function(sub) {
    if(sub.updated >= expirationTime) {
      newCacheList.push(sub);
    } else {
      delete self._cacheMap[sub.hash];
    }
  });

  self._cacheList = newCacheList;
};

SubsManager.prototype._registerComputation = function() {
  var self = this;
  var computation = Deps.autorun(function() {
    if(self.options.expireIn !== 0){
      self._applyExpirations();
    }
    if(self.options.cacheLimit !== 0){
      self._applyCacheLimit();
    }

    var ready = true;
    _.each(self._cacheList, function(sub) {
      sub.ready = Meteor.subscribe.apply(Meteor, sub.args).ready();
      ready = ready && sub.ready;
    });

    if(ready) {
      self.ready = true;
      self.dep.changed();
    }
  });

  return computation;
};

SubsManager.prototype.reset = function() {
  var self = this;
  var oldComputation = self.computation;
  self.computation = self._registerComputation();
  
  // invalidate the new compuation and it will fire new subscriptions
  self.computation.invalidate();

  // after above invalidation completed, fire stop the old computation
  // which then send unsub messages
  // mergeBox will correct send changed data and there'll be no flicker
  Deps.afterFlush(function() {
    oldComputation.stop();
  });
};
