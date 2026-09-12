from collections import defaultdict
import datetime

class TemporalVoting:
    """
    Maintains OCR reads for vehicle tracks and computes the best aggregated 
    plate string using temporal majority voting.
    """
    def __init__(self):
        # track_id -> list of dicts: {'text': str, 'conf': float, 'valid': bool, 'timestamp': datetime}
        self.track_history = defaultdict(list)
        
    def add_read(self, track_id: int, text: str, conf: float, is_valid: bool, timestamp: datetime.datetime = None):
        """
        Record a plate read for a given track ID.
        """
        if timestamp is None:
            timestamp = datetime.datetime.now()
            
        self.track_history[track_id].append({
            'text': text,
            'conf': conf,
            'valid': is_valid,
            'timestamp': timestamp
        })
        
    def get_best_plate(self, track_id: int) -> dict:
        """
        Returns the best aggregated plate read for a track_id.
        """
        history = self.track_history.get(track_id, [])
        if not history:
            return None
            
        # 1. Filter valid reads
        valid_reads = [h for h in history if h['valid']]
        
        # If we have valid reads, only vote among valid reads. 
        # Otherwise, fall back to all reads.
        candidates = valid_reads if valid_reads else history
        
        if not candidates:
            return None
            
        # Count frequencies
        freq = defaultdict(list)
        for cand in candidates:
            # We ignore empty reads in voting
            if cand['text']:
                freq[cand['text']].append(cand['conf'])
                
        if not freq:
            return None
            
        # Find the text with highest frequency. 
        # Tie-breaker: highest average confidence.
        best_text = None
        best_score = -1
        
        for text, confs in freq.items():
            count = len(confs)
            avg_conf = sum(confs) / count
            
            # Score = count * 100 + avg_conf (so count dominates, conf breaks ties)
            score = (count * 100) + avg_conf
            
            if score > best_score:
                best_score = score
                best_text = text
                
        # Calculate final stats for the best text
        if best_text:
            best_confs = freq[best_text]
            final_conf = sum(best_confs) / len(best_confs)
            first_seen = min(c['timestamp'] for c in history if c['text'] == best_text)
            last_seen = max(c['timestamp'] for c in history if c['text'] == best_text)
            is_valid = any(c['valid'] for c in history if c['text'] == best_text)
            
            return {
                'track_id': track_id,
                'plate_text': best_text,
                'confidence': final_conf,
                'valid': is_valid,
                'reads_count': len(best_confs),
                'total_track_frames': len(history),
                'first_seen': first_seen,
                'last_seen': last_seen
            }
            
        return None

    def get_all_finalized_plates(self):
        """
        Returns the best plate for all tracks currently in history.
        """
        results = []
        for track_id in self.track_history.keys():
            best = self.get_best_plate(track_id)
            if best:
                results.append(best)
        return results
