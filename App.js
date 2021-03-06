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
					'Predecessors',
					'DragAndDropRank'],
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
							feature.rank = record.raw.DragAndDropRank;
							feature.jobSize = record.raw.JobSize;
							feature.rroeValue = record.raw.RROEValue;
							feature.timeCriticality = record.raw.TimeCriticality;
							feature.userBusinessValue = record.raw.UserBusinessValue;
							feature.value = feature.rroeValue + feature.timeCriticality + feature.userBusinessValue;
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
						var predecessorFeature = null;
						_.each( features, function(possibleFeature ) {
							if ( possibleFeature.id == record.raw.ObjectID ) {
								predecessorFeature = possibleFeature;
							}
						}, this);
						
						if( predecessorFeature ) {
							feature.predecessors.push( predecessorFeature );
						}
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
		
		this.compileData( features );
	},
	
	calculateWSJFScore: function( feature, features ) {
		if( feature.wsjfScore === 0 ) {
			var totalValue = feature.value;
			var totalJobSize = feature.jobSize;
			
			_.each( feature.predecessors, function( predecessor ) {
				this.calculateWSJFScore( predecessor, features );
				totalValue += predecessor.value;
				totalJobSize += predecessor.jobSize;
			}, this);
			
			//feature.wsjfScore = Math.min( totalValue / totalJobSize, feature.value / feature.jobSize );
			feature.wsjfScore = totalValue / totalJobSize;
		}
	},
	
	compileData: function( features ){
		var scoredFeatures = features;
		var rankedFeatures = features.slice();
		
		scoredFeatures = this.sortFeatures( scoredFeatures, 'wsjfScore' );
		rankedFeatures = this.sortFeatures( rankedFeatures, 'rank' );
		
		var series = [];
		series.push( this.createSeriesCurve( 'WSJF Ideal', scoredFeatures ) );
		series.push( this.createSeriesCurve( 'Current Rank', rankedFeatures ) );
		
		this.makeChart( series );
	},
	
	sortFeatures: function( features, attribute, sortedFeatures ) {
		sortedFeatures = sortedFeatures || [];
		// Sort our list of features by the attribute
		features.sort( function(a, b) { return a[attribute] < b[attribute]; } );
		
		console.log( features );
		
		// See if each feature is already in our sortedFeatures array
		_.each( features, function( feature ) {
			var foundFeature = false;
			_.each( sortedFeatures, function( sortedFeature ) {
				if( sortedFeature.id == feature.id ) {
					foundFeature = true;
				}
			}, this);
			
			// If this is a new Feature for our SortedFeatures, first insert any predecessors we haven't added yet
			if( !foundFeature ) {
				if( feature.predecessors.length > 0 ) {
					this.sortFeatures( feature.predecessors, attribute, sortedFeatures );
				}
				sortedFeatures.push( feature );
			}
		}, this);
		
		return sortedFeatures;
	},
	
	createSeriesCurve: function( name, features ) {
		var series = {};
		series.name = name;
		series.data = [];
		
		var jobSizeIncrementer = 0;
		var featureIndex = 0;
		var sizeInFeature = 0;
		var totalValue = 0;
		while( featureIndex < features.length ) {
			var feature = features[ featureIndex ];
			if( sizeInFeature > feature.jobSize ) {
				featureIndex++;
				sizeInFeature = sizeInFeature - feature.jobSize;
				totalValue += feature.value;
			}
			
			var lastFeatureName = 'N/A';
			if ( featureIndex < features.length ) {
				lastFeatureName = features[ featureIndex ].name;
			}
			series.data.push( {
				y: totalValue,
				tooltip: 'Value: ' + totalValue + '<br/>Feature: ' + lastFeatureName
			} );
			sizeInFeature++;
		}
		return series;
	},
		
	makeChart: function( seriesData ){
	
		var chart = this.add({
				xtype: 'rallychart',
				chartConfig: {
					chart:{
						type: 'line'
					},
					legend: {
						enabled: true
					},
					xAxis: {
						title: {
							text: 'Job Size'
						},
						labels: {
							formatter: function () {
								return this.value;
							}
						},
						tickInterval: 1,
						min: 0
					},
					yAxis: {
						title: {
							text: 'Value'
						},
						labels: {
							formatter: function () {
								return this.value;
							}
						},
						tickInterval: 1,
						min: 0
					},
					title:{
						text: 'Projected Value over Time'
					},
					tooltip: {
						useHTML: true,
						pointFormat: '{point.tooltip}',
						headerFormat: ''
					},
					plotOptions: {
						series: {
							dataLabels: {
								enabled: false
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