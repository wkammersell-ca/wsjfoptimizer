Ext.define('CustomApp', {
	extend: 'Rally.app.TimeboxScopedApp',
	scopeType: 'release',
	
	onScopeChange: function( scope ) {
		this.callParent( arguments );
		this.start( scope );
	},
	
	start: function( scope ) {
		// Delete any existing UI components
		if( this.down( 'label' ) ) {
			this.down( 'label' ).destroy();
		}
		
		// Show loading message
		this._myMask = new Ext.LoadMask( Ext.getBody(),
			{
				msg: "Loading..."
			}
		);
		this._myMask.show();
		
		console.log("Loading Feature for " + scope.record.data.Name);
		var dataScope = this.getContext().getDataContext();
		var store = Ext.create(
			'Rally.data.wsapi.artifact.Store',
			{
				models: ['PortfolioItem/Feature'],
				fetch: [
					'ObjectID',
					'JobSize',
					'RROEValue',
					'TimeCriticality',
					'UserBusinessValue',
					'WSJFScore',
					'Name',
					'Predecessors'],
				filters: [
					{
						property: 'Release.Name',
						value: scope.record.data.Name
					}
				],
				context: dataScope,
				limit: Infinity
			},
			this
		);
			
		store.load( {
			scope: this,
			callback: function( records, operation ) {
				if( operation.wasSuccessful() ) {
					if (records.length > 0) {
						var features = [];
						
						// Translate data into new structure
						_.each(records, function( record ){
							var feature = {};
							feature.ref = record.raw._ref; //Get Ref;
							feature.id = record.raw.ObjectID;
							feature.name = record.raw.Name;
							feature.jobSize = record.raw.JobSize;
							feature.rroeValue = record.raw.RROEValue;
							feature.timeCriticality = record.raw.TimeCriticality;
							feature.userBusinessValue = record.raw.UserBusinessValue;
							feature.wsjfScore = record.raw.WSJFScore;
							feature.predecessorsCount = record.raw.Predecessors.Count;
							feature.predecessors = [];
							
							//TODO - If JobSize is zero, perhaps we can look at the preliminary estimate?
							if( feature.jobSize !== 0 ) {
								features.push( feature );
							}
						},this);
						
						this.checkPredecessors( features );
						
					} else if(records.length === 0 && this.features.length === 0){
							this.showNoDataBox();	
					} 
				}
			}
		});
	},
	
	checkPredecessors: function( features ) {
		var foundPredecessor = false;
		_.each(features, function( feature ){
			if( feature.predecessors.length < feature.predecessorsCount && !foundPredecessor ) {
				foundPredecessor = true;
				this.loadPredecessors( feature, features );
			}
		},this);
		
		if ( !foundPredecessor ) {
			this.calculateWSJFScores( features );
		}
	},
	
	loadPredecessors: function( feature, features ) {
		console.log( "Loading predecessors for " + feature.id );
		var dataScope = this.getContext().getDataContext();
		var store = Ext.create(
			'Rally.data.wsapi.artifact.Store',
			{
				models: ['PortfolioItem/Feature'],
				fetch: [
					'ObjectID'
				],
				filters: [
					{
						property: 'Successors',
						operator: 'contains',
						value: feature.ref
					}
				],
				context: dataScope,
				limit: Infinity
			},
			this
		);
			
		store.load( {
			scope: this,
			callback: function( records, operation ) {
				if( operation.wasSuccessful() ) {
					_.each(records, function( record ){
						feature.predecessors.push( record.raw.ObjectID );
					},this);
				}
				this.checkPredecessors( features );
			}
		});
	},
	
	calculateWSJFScores: function( features ) {
		console.log( "Calculating WSJF Scores" );
		_.each(features, function( feature ){
			this.calculateWSJFScore( feature, features );
		},this);						
		
		console.log( "Sorting Features by WSJF Score" );
		_.sortBy( features, "wsjfScore" );
		console.log( features );
	},
	
	calculateWSJFScore: function( feature, features ) {
		if( feature.wsjfScore === 0 ) {
			var totalValue = feature.rroeValue + feature.timeCriticality + feature.userBusinessValue;
			var totalJobSize = feature.jobSize;
			
			_.each( feature.predecessors, function( predecessorID ) {
				var predecessor = null;
				_.each( features, function( predecessorFeature ) {
					if( predecessorFeature.id == predecessorID ) {
						predecessor = predecessorFeature;
					}
				}, this);
						
				this.calculateWSJFScore( predecessor, features );
				totalValue += predecessor.rroeValue + predecessor.timeCriticality + predecessor.userBusinessValue;
				totalJobSize += predecessor.jobSize;
			}, this);
			
			feature.wsjfScore = totalValue / totalJobSize;
		}
	},
	
	compileData: function(){
		var chartArray = [];
		// Initialize array
		for ( x = 0; x < this.CAIntents.length; x++ ) {
			chartArray.push( [] );
			for ( y = 0; y < this.customerPerceivedValues.length; y++ ) {
				chartArray[ x ].push( [] );
			}
		}
		
		// Put Initiatives into the array
		_.each( this.initiatives, function( initiative ) {
			if( initiative.CAIntent && initiative.customerPerceivedValue ) {
				chartArray[ this.CAIntents.indexOf( initiative.CAIntent ) ][ this.customerPerceivedValues.indexOf( initiative.customerPerceivedValue ) ].push( initiative );
			}
		}, this );
		
		// Convert the array into series
		var seriesData = [];
		for ( x = 0; x < this.CAIntents.length; x++ ) {
			for ( y = 0; y < this.customerPerceivedValues.length; y++ ) {
				var cell = chartArray[ x ][ y ];
				if ( cell.length > 0 ) {
					cell.sort( function( a, b ) { return a.estimate < b.estimate; } );
					
					var series = {};
					var cellEstimate = cell.reduce( function( total, a ) { return total + a.estimate; }, 0 );
					
					series.marker = { 
						fillColor: cell[ 0 ].displayColor,
						lineColor: '#000000'
					};
					series.data = [ {
						x: x,
						y: y,
						z: ( cellEstimate / this.totalPoints ) * 100,
						name: cell.reduce( function( string, a ) { return string + a.formattedId + '<br/>'; }, "" ),
						tooltip: cell.reduce( function( string, a ) { return string + '<b>' + a.formattedId + ': </b>' + a.name + ' = ' + ( Math.round( ( a.estimate / cellEstimate ) * 100 ) ) + '%<br/>'; }, "" ),
						color: cell[ 0 ].displayColor
					} ];
					seriesData.push( series );
				}
			}
		}
		this.makeChart( seriesData );
	},
	
	makeChart: function( seriesData ){
		var CAIntentsCategories = this.CAIntents;
		var customerPerceivedValuesCategories = this.customerPerceivedValues;
	
		var chart = this.add({
				xtype: 'rallychart',
				chartConfig: {
					chart:{
						type: 'bubble',
						zoomType: 'xy'
					},
					legend: {
						enabled: false
					},
					xAxis: {
						title: {
							text: 'CA Intent'
						},
						labels: {
							formatter: function () {
								return CAIntentsCategories[ this.value ];
							}
						},
						tickInterval: 1,
						min: 0,
						max: CAIntentsCategories.length - 1
					},
					yAxis: {
						title: {
							text: 'Customer Perceived Value'
						},
						labels: {
							formatter: function () {
								return customerPerceivedValuesCategories[ this.value ];
							}
						},
						tickInterval: 1,
						min: 0,
						max: customerPerceivedValuesCategories.length - 1
					},
					title:{
						text: 'Initiatives by CA Intents and Customer Perceived Value'
					},
					tooltip: {
						useHTML: true,
						pointFormat: '{point.tooltip}',
						headerFormat: ''
					},
					plotOptions: {
						series: {
							dataLabels: {
								enabled: true,
								useHTML: true,
								format: '{point.name}',
								color: '#ffffff',
								shadow: false
							}
						}
					}
				},
									
				chartData: {
					series: seriesData
				} 
		});
		
		this._myMask.hide();
	},
	
	showNoDataBox:function(){
		this._myMask.hide();
		this.add({
			xtype: 'label',
			text: 'There is no data. Check if there are work items assigned for the Release.'
		});
	}
});