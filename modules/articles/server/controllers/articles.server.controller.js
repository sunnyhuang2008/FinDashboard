'use strict';

/**
 * Module dependencies
 */
var path = require('path'),
  mongoose = require('mongoose'),
  Manager = mongoose.model('Manager'),
   request = require('request'),
  yahooFin = require('yahoo-finance'),
  math = require('mathjs'),
  errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller'));

/*
Getting historical Data
*/
global.hisPrice = [];
global.benchHisPrice = [];
global.start = null;
global.end = null; 

exports.list_ticker_price = function(req, res) {
  var tickers = req.body;
  global.hisPrice = [];
  global.benchHisPrice = [];
  global.start = tickers.start;
  global.end = tickers.end;

  yahooFin.historical({
      symbols: tickers.ticker,
      from: tickers.start,
      to: tickers.end,
      period: tickers.period
    }).then(function(quotes){

      for(var stuff in quotes){
        
        var quote = {
        'name': stuff,
        'price': quotes[stuff],
        'bench': 0
      };
      global.hisPrice.push(quote); 
      
      } 
      
      
    }).then(function(){


        if(tickers.benchComp.length ===0){
             var retPackage = {
              'active': global.hisPrice,
              'benchmark': global.benchHisPrice
            };

             res.json(retPackage);
        }else{
          yahooFin.historical({
          symbols: tickers.benchComp,
          from: tickers.start,
          to: tickers.end,
          period: tickers.period
        }).then(function(quotes){
          
          
          for(var stuff in quotes){

            var quote = {
            'name': stuff,
            'price': quotes[stuff],
            'bench': 1
          };
          console.log(quote);
          global.benchHisPrice.push(quote); 
          
          }
       
        }).then(function(){
           var retPackage = {
              'active': global.hisPrice,
              'benchmark': global.benchHisPrice
            };

             res.json(retPackage);
        });

        }
        
        
    });

  

  
};

function correlation(x, y){
      // body...
      var shortestArrayLength = 0;
     
    if(x.length == y.length) {
        shortestArrayLength = x.length;
    } else if(x.length > y.length) {
        shortestArrayLength = y.length;
        console.error('x has more items in it, the last ' + (x.length - shortestArrayLength) + ' item(s) will be ignored');
    } else {
        shortestArrayLength = x.length;
        console.error('y has more items in it, the last ' + (y.length - shortestArrayLength) + ' item(s) will be ignored');
    }
  
    var xy = [];
    var x2 = [];
    var y2 = [];
  
    for(var i=0; i<shortestArrayLength; i++) {
        xy.push(x[i] * y[i]);
        x2.push(x[i] * x[i]);
        y2.push(y[i] * y[i]);
    }
  
    var sum_x = 0;
    var sum_y = 0;
    var sum_xy = 0;
    var sum_x2 = 0;
    var sum_y2 = 0;
  
    for(var i=0; i< shortestArrayLength; i++) {
        sum_x += x[i];
        sum_y += y[i];
        sum_xy += xy[i];
        sum_x2 += x2[i];
        sum_y2 += y2[i];
    }
  
    var step1 = (shortestArrayLength * sum_xy) - (sum_x * sum_y);
    var step2 = (shortestArrayLength * sum_x2) - (sum_x * sum_x);
    var step3 = (shortestArrayLength * sum_y2) - (sum_y * sum_y);
    var step4 = Math.sqrt(step2 * step3);
    var answer = step1 / step4;
  
    return answer;
};


//We need historical returns first! 
exports.covariance = function(req, res){

  //console.log(req.body);

//What we send back to the front end
var responsePackage = {
  'variance': null,
  'covariance': null,
  'individual_data': null,
  'weights':null
};

var portfolioWeights = req.body.active;

var portfolioReturns =[];

  if(global.hisPrice.length == 0){
    console.log("Error need historical returns first");
    res.writeHead(500, 'Need historial returns first',{
  'Content-Length': Buffer.byteLength('Need historial returns first'),
  'Content-Type': 'text/plain' });
    return;
  }

//Introducing the benchmarks
console.log(global.benchHisPrice);
  for(var item of global.benchHisPrice){
    global.hisPrice.push(item);
  }
console.log("____________________________");
console.log(global.hisPrice);

global.hisPrice.forEach(function(holding, index){

        request('https://www.quandl.com/api/v3/datasets/VOL/'+holding.name+'.json?column_index=25&start_date='+global.end+'&end_date='+global.end+'&api_key=ZcDqZyg9kM9oVVuHFA1p',
            function(error, response, body){

            var returnVec = [];
            for(var i =0; i < holding.price.length-1; i++){
              returnVec.push((holding.price[i].adjClose/holding.price[i+1].adjClose)-1);
            }
            
              if(!error && response.statusCode == 200){

                var content = JSON.parse(body);
                if(content.dataset.data.length === 0){
                  res.json("No Data avaliable, try different date");
                  return;
                }

                var componentReturn = {
                  'name': holding.name,
                  'returns': returnVec,
                  'latestClose': holding.price[0].adjClose,
                  'implied_vol': content.dataset.data[0][1],
                  'bench': holding.bench
                };

                portfolioReturns.push(componentReturn);

                //For Synchronization purposes
                if(portfolioReturns.length-1 === global.hisPrice.length-1){
                  //console.log(portfolioReturns);
                  var portfolioValue = 0;
                  var weights = [];
                  //Calculate total portfolio value
                //  console.log(portfolioWeights);
                  for(var component of portfolioReturns){

                     var comp = portfolioWeights.find(function(item){
                      if(item.name === component.name){return item;}
                      return null;
                    });

                    if(component.bench == 0){
                    var componentWeight = component.latestClose*comp.shares;
                   // console.log(componentWeight);
                    //console.log(component.latestClose);
                    weights.push(componentWeight);
                    portfolioValue += componentWeight;
                  }
                   
                  }
                  //console.log(portfolioValue);
                

                 weights.forEach(function(weight,index){
                  //console.log(weight);
                  weights[index] = weight/portfolioValue;
                 });

                 //Benchmark weights
                 for(var item of req.body.benchmark){
                  weights.push(item.weight*(-1));
                 }

               //  console.log(weights);
               //  console.log(portfolioReturns);
                  var weightVector = math.matrix(weights);
                  var covMatrix = []; 


                  for(var component1 of portfolioReturns){
                    var row = [];
                    for(var component2 of portfolioReturns){
                      row.push(correlation(component1.returns, component2.returns)*component1.implied_vol*component2.implied_vol);
                    }
                    covMatrix.push(row);
                  }
                  var cov = math.matrix(covMatrix);
                  //console.log(cov.valueOf());
                  var variance = math.multiply(math.multiply(weightVector, cov), math.transpose(weightVector));
                 // console.log(variance);
                  responsePackage.variance= variance;
                  responsePackage.covariance = covMatrix;
                  responsePackage.individual_data = portfolioReturns;
                  responsePackage.weights = weights;
                  res.json(responsePackage);
                }
                
              }
            }); 
           
      });

};

/*Get Implied Volatilities*/
exports.getImpliedVols = function(req, res){
  request('https://www.quandl.com/api/v3/datasets/VOL/AAL?column_index=25&start_date=2018-03-05&end_date=2018-03-05&api_key=ZcDqZyg9kM9oVVuHFA1p',
    function(error, response, body){
      if(!error && response.statusCode == 200){
        //console.log(body);
        //test();
      }
    });
};



/*
Grabbing results
*/
global.summaryResult =[]; 
exports.list_ticker_summary = function(req, res){
var ticker = req.body;

for(var i = 0; i < ticker.ticker.length; i ++){
  yahooFin.quote({  
    symbol: ticker.ticker[i],
    modules: ticker.modules
  }).then(function(quote){
    //console.log(quote);
    global.summaryResult.push(quote);
  }); 
}

res.json(global.summaryResult);
global.summaryResult = [];

};

/* Create Manager*/
exports.create = function(req, res){
  var Manager = new Manager(req.body);

  Manager.user = req.body.user;
  Manager.portfolio = req.body.portfolio; 

  Manager.save(function(err){
    if(err){
      return res.status(400).send({
        message: errorHandler.getErrorMessage(err)
      });
    }
    res.jsonp(Manager);
  });
};

/*Update Manager*/
exports.update = function(req, res){};

/**
 * Article middleware
 */
/*exports.articleByID = function (req, res, next, id) {

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send({
      message: 'Article is invalid'
    });
  }

  Article.findById(id).populate('user', 'displayName').exec(function (err, article) {
    if (err) {
      return next(err);
    } else if (!article) {
      return res.status(404).send({
        message: 'No article with that identifier has been found'
      });
    }
    req.article = article;
    next();
  });
};*/
