'use strict';

// ## Module Dependencies
var _ = require('lodash');
var Architect = require('neo4j-architect');
var db = require('../db');
var QueryBuilder = require('../neo4j-qb/qb.js');
var util = require('util');
var utils = require('../utils');
var when = require('when');

// ## Models
var Skill = require('./skills');
var Loc = require('./locations');
var Job = require('./jobs');

Architect.init();

var Construct = Architect.Construct;

// Presently only schema properties are being used in the query builder. 
// The value doesn't matter right now.
var schema = {
  id: String, // linkedIn ID
  firstname: String,
  lastname: String,
  email: String,
  linkedInToken: String,
  profileImage: String
};

var qb = new QueryBuilder('User', schema);

// ## Model

var User = function (_data) {
  _.extend(this, _data);

  // get the id from the self property returned by neo4j
  this.nodeId = +this.self.split('/').pop();
};

User.prototype.modelName = 'User';


// ## Results Functions
// To be combined with queries using Construct

var _singleUser = _.partial(utils.formatSingleResponse, User);
var _manyUsers = _.partial(utils.formatManyResponse, User);


// ## Query Functions
// Should be combined with results functions using Construct

var _matchByUUID = qb.makeMatch(['id']);

var _matchAll = qb.makeMatch();

var _create = (function () {
  
  var onCreate = {
    created: 'timestamp()'
  };

  return qb.makeMerge(['id'], onCreate);
})();

// var _update = qb.makeUpdate(['id']);

var _delete = qb.makeDelete(['id']);

var _deleteAll = qb.makeDelete();

var _createManySetup = function (params, callback) {
  if (params.list && _.isArray(params.list)) {
    callback(null, _.map(params.list, function (data) {
      return _.pick(data, Object.keys(schema));
    }));
  } else {
    callback(null, []);
  }
};


// ## Constructed Functions

// var create = function (params, options, callback) {
//   var func = new Construct(_create, _singleUser);
  
//   // Do any data cleaning/prep here

//   func.done().call(this, params, options, callback);
// };


// Create uses MERGE so it serves as both the create and update function
var create = function (params, options) {
  var allPromises = [];
  var func = new Construct(_create, _singleUser);
  var p1 = when.promise(function (resolve) {

    // @NOTE Do any data cleaning/prep here...
    
    func.done().call(null, params, options, function (err, results, queries) {
      resolve({results: results, queries: queries});
    });
  });

  // @NOTE Post save actions can be done here...
  p1.then(function (results) {
    var _res = results.results;

    // Create the (User)->(Users) relationship
    if (_res.node.data.linkedInToken) {
      _res.node.joined(_.noop);
    }
    
    return results;
  });

  allPromises.push(p1);

  // Create the Users skills
  if (params.skills) {
    allPromises.push(Skill.createMany(params.skills, options));
  }

  if (params.location) {
    allPromises.push(Loc.create(params.location, options));
  }
  
  var all = when.all(allPromises);

  // Things to do once users, skills, location, etc have been created
  all.then(function (results) {
    var userResults = results[0];
    var skillResults = results[1];
    var locResults = results[2];
    var user = userResults.results.node;

    var skills = _.map(skillResults, function (res) {
      return res.results.node;
    });

    if (skillResults) {
      user.hasSkill(skills, _.noop);
    }

    if (locResults) {
      user.atLocation(locResults.results.node, _.noop);
    }

    return results;
  });

  return all;
};

// create many new users
var createMany = new Construct(_createManySetup).map(create);

var _queryRelationship = function (from, relationship) {

  return when.promise(function (resolve){

    var all = {
      'skills' : 'HAS_SKILL',
      // for future node connections
      // 'location' : 'WANTS_LOCATION',
      // 'roles' : 'HAS_ROLE'
    };

    var query = [];
    var qs = '';
    var cypherParams = {
      id: from.node.data.id,
    };

    query.push(util.format('MATCH (a:%s {id:{id}})-[:%s]->(node)', from.object, all[relationship]));
    query.push('RETURN node');

    qs = query.join('\n');

    // console.log(qs);

    db.query(qs, cypherParams, function (err, results) {
      results = _.map(results, function (result) {
        return result.node._data;
      });

      var res = {};
      res[relationship] = results;
      resolve(res);
    });
  });
};

var getById = function (params, options) {
  var func = new Construct(_matchByUUID).query().then(_singleUser);
  var clone = _.clone(params);

  var p1 = when.promise(function (resolve) {

    if (!clone.id && clone.userId) clone.id = clone.userId;

    func.done().call(null, clone, options, function (err, results, queries) {
      resolve({results: results, queries: queries});
    });
  });

  if (!clone.related) {
    return p1;
  } else {
    return p1.then(function (userResults) {
      
      var p = [];

      _.each(clone.related, function (value) {
        p.push(_queryRelationship(userResults.results, value));
      });
      // console.log(p, 'promise array');
      
      return when.all(p).then(function (relatedResults) {
        // console.log(relatedResults, 'RELATED RESULTS');

        _.each(relatedResults, function (related) {
          _.extend(userResults.results.node.data, related);
        });

        // console.log(userResults);
        // console.log('\n\n');
        // console.log(userResults.results.node.data);

        return userResults;
      });

      
      // return when.all

      // _queryRelationship(userResults.results, clone.related).then(function (relatedResults) {
      //   console.log('FINAL RESULTS, user and related');
      //   console.log(userResults);
      //   console.log(relatedResults);
      //   console.log(relatedResults.concat(userResults));
      //   return relatedResults.concat(userResults);
      // });
    });
  }

};

var getUserJobs = function (params, options) {
  var func = new Construct(_matchByUUID).query().then(_singleUser);
  var clone = _.clone(params);

  var p1 = when.promise(function (resolve) {
    func.done().call(null, clone, options, function (err, results, queries) {
      // console.log(results);
      resolve({results: results, queries: queries});
    });
  });

  return p1.then(function (userResults) {
    if (clone.type === 'latest') {
      return Job.getLatest(userResults.results.node).then(function (jobResults) {
        return jobResults;
      });
    } else if (clone.type === 'likes') {
      return Job.getLiked(userResults.results.node).then(function (jobResults) {
        return jobResults;
      });
    } else {
      return Job.getRecommended(userResults.results.node).then(function (jobResults) {
        return jobResults;
      });
    }
  });
};

// var that = this;
//   var query = [];
//   var qs = '';
  
//   query.push('MATCH (a) WHERE id(a) = {from}');
//   query.push('MATCH (b:Users)');
//   query.push('CREATE UNIQUE (a)-[:JOINED {date:timestamp()}]->(b)');
//   qs = query.join('\n');

//   db.query(qs, {from: that.nodeId}, callback);

var getAll = new Construct(_matchAll, _manyUsers);

// get a user by id and update their properties
// var update = new Construct(_update, _singleUser);

// delete a user by id
var deleteUser = new Construct(_delete);

// delete a user by id
var deleteAllUsers = new Construct(_deleteAll);

var rateJob = function (params, options) {

  // Promises returned by getById
  var p1 = User.getById(params, options);
  var p2 = Job.getById(params, options);

  var all = when.join(p1,p2);

  // Things to do once users, skills, location, etc have been created
  all.then(function (results) {
    var userResults = results[0];
    var jobResults = results[1];

    var user = userResults.results.node;
    var job = jobResults.results.node;

    // console.log(user, 'this is the user node');

    if (params.like === 'true'){
      user.likes(job, _.noop);
    } else if (params.like === 'false'){
      user.dislikes(job, _.noop);
    }

    return results;
  });

  return all;
};

var removeRelationships = function (params, options) {

  var type = params.type;
  var cypherParams = {};

  // set the user id
  cypherParams.id = params.id;

  var rels = {
    'skills': 'HAS_SKILL',
    'locations': 'WANTS_LOCATION'
  };

  var labels = {
    'skills': 'Skill',
    'locations': 'Location',
  };

  var query = [];
  var qs = '';

  // There is a good chance that params.relationship is JSON string when it gets here
  // so parse this and turn it back into an object
  if (typeof params.relationships === 'string') {
    params.relationships = JSON.parse(params.relationships);
  }

  // If no relationships to change then stop early
  if (!params.relationships.length) {
    return when.promise(function (resolve) {
      resolve({results: {}, options: options});
    });
  }

  // Example Query:
  // match (a:User {id:{id}})-[r:HAS_SKILL]-(b:Skill)
  // where b.normalized = {_0} 
  // or b.normalized = {_1}
  // or b.normalized = {_2}
  // delete r

  // Otherwise build the query
  query.push(util.format('MATCH (a:User {id:{id}})-[r:%s]-(b:%s)', rels[type], labels[type]));

  _.each(params.relationships, function (rel, i) {
    var key = '_' + i;
    var where = [];
    
    if (i === 0) where.push('where');
    else where.push('or');

    if (type === 'skills') {
      cypherParams[key] = rel.normalized;
      where.push(util.format('b.normalized = {%s}', '_' + i));
      query.push(where.join(' '));
    }
  });

  query.push('delete r');
  qs = query.join('\n');

  return when.promise(function (resolve) {
    db.query(qs, cypherParams, function (err, results) {
      resolve({results: results, options: options});
    });
  });
};

// relationships:

/**
 * _hasRelationship
 *
 * Helper function used to create new 'relationship' functions using _.partial
 *
 * @param rel {object} *required*
 *  - rel.label {string} *required* label of the relationship to be added
 *  - rel.props {object} property to be added to each of the created relationships
 *
 * @param to {object|array} *required* a node object or an array of node objects
 *
 * @param callback {func}
 */
var _hasRelationship = function (rel, to, callback) {
  
  if (!rel.label) throw new Error('You must give this relationship a label');
  
  var label = rel.label;
  var props = rel.props || {};
  var that = this;
  var query = [];
  var qs = '';
  var toArr = [];
  var cypherParams = {};

  // Make sure to is an array
  if (!Array.isArray(to)) toArr.push(to);
  else toArr = to;

  // Build the cypherParams
  cypherParams.from = that.nodeId; // add the 'from' nodeID

  _.each(toArr, function (toNode, index) {
    var ident = 'ident_' + index;

    cypherParams[ident] = toNode.nodeId;

    // @NOTE 
    // MATCH statement must come before CREATE
    //
    // START may be deprecated soon... starting with Neo4J 2.0 so using 
    // MATCH + WHERE is the recommended way to find a node by nodeId
  
    // query.unshift('START a=node({from}), b=node({to})');
    query.unshift(util.format('MATCH (%s) WHERE id(%s) = {%s}', ident, ident, ident));
    query.push(util.format('CREATE UNIQUE (a)-[:%s %s]->(%s)', label, JSON.stringify(props), ident));
  });

  // add the user node to the front
  query.unshift('MATCH (a) WHERE id(a) = {from}');

  qs = query.join('\n');

  db.query(qs, cypherParams, callback);
};


/**
 * Builds and executes a query to create a relationship between this user 
 * and other skill nodes
 *
 * @param nodes {object|array} a skill node or an array of skill nodes
 * @param callback {func}
 */
User.prototype.hasSkill = _.partial(_hasRelationship, {label:'HAS_SKILL'});

User.prototype.joined = function (callback) {
  var that = this;
  var query = [];
  var qs = '';
  
  query.push('MATCH (a) WHERE id(a) = {from}');
  query.push('MATCH (b:Users)');
  query.push('CREATE UNIQUE (a)-[:JOINED {date:timestamp()}]->(b)');
  qs = query.join('\n');

  db.query(qs, {from: that.nodeId}, callback);
};

/**
 * Builds and executes a query to create a relationship between this user
 * and other user nodes
 *
 * @param nodes {object|array} a user node or an array of user nodes
 * @param callback {func}
 */
User.prototype.knows = _.partial(_hasRelationship, {label: 'KNOWS'});


/**
 * Builds and executes a query to create a relationship between this user
 * and his/her location
 *
 * @param nodes {object} a location node
 * @param callback {func}
 */
User.prototype.atLocation = _.partial(_hasRelationship, {label: 'WANTS_LOCATION'});

User.prototype.likes = _.partial(_hasRelationship, {label: 'LIKES'});
User.prototype.dislikes = _.partial(_hasRelationship, {label: 'DISLIKES'});


// static methods:

User.create = create;
User.createMany = createMany.done();
User.deleteUser = deleteUser.done();
User.deleteAllUsers = deleteAllUsers.done();
User.getById = getById;
User.getAll = getAll.done();
// User.update = update.done();
User.update = create;
User.rateJob = rateJob;
// User.getRecommendations = getRecommendations;
User.removeRelationships = removeRelationships;
User.getUserJobs = getUserJobs;

module.exports = User;
