'use strict';

var fs = require('fs');
var request = require('request');


exports.parseTags = function(angel, output){
  if (angel.tags.length) {
    for (var i=0; i<angel.tags.length; i++){
      var tag = angel.tags[i];
      if (tag.tag_type === 'LocationTag') {
        output.loc.city = tag.name;
      } else if (tag.tag_type === 'RoleTag') {
        output.roles.push({name: tag.name});
      } else if (tag.tag_type === 'SkillTag') {
        output.skills.push({name: tag.name});
      }
    }
  }
  output.roles = JSON.stringify(output.roles);
  output.skills = JSON.stringify(output.skills);
  output.loc = JSON.stringify(output.loc);
};

exports.parseObj= function(angel){
  var output = {};
  output.id = angel.id;
  output.title = angel.title;
  output.created = angel.created_at;
  output.company = {
    name: angel.startup.name,
    id: angel.startup.id,
    logoUrl: angel.startup.logo_url,
    quality: String(angel.startup.quality),
    productDesc: angel.startup.product_desc,
    highConcept: angel.startup.high_concept,
    followerCount: String(angel.startup.follower_count),
    companyUrl: angel.startup.company_url,
    today: new Date().toISOString().slice(0,10)
  };
  output.salary = JSON.stringify({
    currency: angel.currency_code,
    salaryMax: Number(angel.salary_max),
    salaryMin: Number(angel.salary_min)
  });
  output.equity = JSON.stringify({
    equityMax: Number(angel.equity_max),
    equityMin: Number(angel.equity_min)
  });
  output.roles = [];
  output.skills = [];
  output.loc = {};
  exports.parseTags(angel, output);
  return output;
};

exports.appendJob = function (job) {
  return function (err, res, body) {
    if (err) console.error(err);
    body = JSON.parse(body);
    job.company.companySize = body.company_size;
    job.company.twitterUrl = body.twitter_url;
    job.company.blogUrl = body.blog_url;
    job.company = JSON.stringify(job.company);
    // fs.appendFile('db.txt', JSON.stringify(job) + '\n', function(err){
    //   if (err) console.error(err);
    // });
    var options = {
      url: 'http://127.0.0.1:3000/api/v0/jobs',
      method: 'POST',
      headers: {
        'api_key': 'special-key'
      },
      json: job
    };

    request(options, function (err, res, body) {
      if (err) console.error('Could not create job', err);
    });
  };
};